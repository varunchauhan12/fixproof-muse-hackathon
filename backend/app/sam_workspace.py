"""Candidate-bound single-image SAM investigation. No database writes or tracking.

Results are bounded, TTL-limited process memory. Existing provider and frame loader
are injected; importing this module does not initialize the vault or registry.
"""
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import hashlib
import io
import json
import math
import threading
import time

from fastapi import HTTPException
from PIL import Image


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, allow_nan=False).encode()).hexdigest()[:32]


def normalized_box(box):
    """Reject invalid pixel coordinates before using provider normalization (which clamps)."""
    if not isinstance(box, dict):
        return None
    coords = [box.get(k) for k in ('x1', 'y1', 'x2', 'y2')]
    width, height = box.get('w'), box.get('h')
    if not all(number(v) for v in [*coords, width, height]) or not width or not height:
        return None
    x1, y1, x2, y2 = coords
    if not (0 <= x1 < x2 <= width and 0 <= y1 < y2 <= height):
        return None
    values = [x1 / width, y1 / height, x2 / width, y2 / height]
    declared = box.get('normalized_coords')
    if declared and (len(declared) != 4 or not all(number(v) for v in declared) or any(abs(a-b) > .001 for a,b in zip(values,declared))):
        return None
    return values


def candidate_queue(incident, threshold):
    pairs = []
    for index, frame in enumerate(incident.get('frame_matches') or []):
        sub = frame.get('submitted_frame') or {}
        seen = set()
        rank = 0
        for candidate in [frame.get('best_match'), *(frame.get('top_candidates') or [])]:
            if not candidate:
                continue
            identity = [candidate.get(k) for k in ('source_asset_id', 'source_frame_id', 'source_filename', 'source_timestamp_sec')]
            key = json.dumps(identity)
            if key in seen:
                continue
            seen.add(key)
            rank += 1
            # SAM queue is limited to explicit backend CV-passed/confirmed candidates.
            distance = candidate.get('l2_distance')
            if not number(distance) or distance >= threshold or candidate.get('low_entropy_flag') or candidate.get('match_confirmed') is not True or candidate.get('similarity_status') == 'NO_MATCH':
                continue
            ref_asset = candidate.get('source_asset_id')
            if not ref_asset or ref_asset in ('unknown', 'other_asset', 'unregistered'):
                continue
            if not number(sub.get('timestamp_sec')) or not number(candidate.get('source_timestamp_sec')):
                continue
            def filename(record, field, path):
                return record.get(field) or (record.get(path) or '').replace('\\', '/').rsplit('/', 1)[-1]
            pair = {
                'incident_id': incident.get('incident_id'), 'frame_match_index': index, 'rank': rank,
                'evidence_id': candidate.get('evidence_id') or frame.get('evidence_id'),
                'confirmed': candidate.get('match_confirmed') is True,
                'status': candidate.get('similarity_status') or ('CV threshold passed' if candidate.get('match_confirmed') is True else 'Unconfirmed CV candidate'),
                'l2_distance': distance,
                'visual_similarity_score': (candidate.get('visual_similarity_score', candidate.get('confidence_score')) if number(candidate.get('visual_similarity_score', candidate.get('confidence_score'))) else None),
                'reference': {'asset_id': ref_asset, 'frame_id': candidate.get('source_frame_id'), 'filename': filename(candidate, 'source_filename', 'source_frame_path'), 'timestamp_sec': candidate['source_timestamp_sec']},
                'suspect': {'asset_id': sub.get('asset_id') or incident.get('submitted_asset_id') or incident.get('incident_id'), 'frame_id': sub.get('frame_index'), 'filename': filename(sub, 'filename', 'frame_path'), 'timestamp_sec': sub['timestamp_sec']},
            }
            # Only immutable source association defines identity; CV measurements may be refreshed.
            pair['candidate_id'] = fingerprint({k: pair[k] for k in ('incident_id', 'frame_match_index', 'reference', 'suspect')})
            pairs.append((pair, frame, candidate))
    return pairs


class SAMWorkspace:
    def __init__(self, load_incident, load_frame, provider, threshold, demo_mode=lambda: False, clock=time.monotonic):
        self.load_incident, self.load_frame, self.provider = load_incident, load_frame, provider
        self.threshold, self.demo_mode, self.clock = threshold, demo_mode, clock
        self.cache = OrderedDict()
        self.auto_cache = OrderedDict()
        self.auto_errors = OrderedDict()
        self.raw_frames = OrderedDict()
        self.frame_inflight = {}
        self.concept_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix='fixproof-sam')
        self.inference_slots = threading.BoundedSemaphore(4)
        self.discovery_slots = threading.BoundedSemaphore(2)
        self.inflight = set()
        self.lock = threading.Lock()
        self.ttl, self.limit = 1800, 64

    def authorized(self, incident_id, session):
        import re
        if not session or not re.fullmatch(r'[A-Za-z0-9_-]{3,64}', session):
            raise HTTPException(400, 'A valid client session header is required.')
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,128}', incident_id):
            raise HTTPException(400, 'Invalid incident identifier.')
        incident = self.load_incident(incident_id)
        if not incident:
            raise HTTPException(404, 'Incident not found.')
        if not self.demo_mode() and incident.get('session_id') not in (session, 'demo-showcase'):
            raise HTTPException(403, 'Incident is unavailable in this session.')
        return incident

    def queue(self, incident_id, session):
        incident = self.authorized(incident_id, session)
        return [pair for pair, _, _ in candidate_queue(incident, self.threshold())]

    def resolve(self, incident_id, candidate_id, session):
        incident = self.authorized(incident_id, session)
        for pair, frame, candidate in candidate_queue(incident, self.threshold()):
            if pair['candidate_id'] == candidate_id:
                return pair, frame, candidate
        raise HTTPException(404, 'Eligible CV candidate not found; refresh the candidate queue.')

    def frame_bytes(self, pair, frame, candidate, target):
        association = pair[target]
        if not association['filename']:
            raise HTTPException(404, 'Recorded frame location is unavailable.')
        path = (frame.get('submitted_frame') or {}).get('frame_path') if target == 'suspect' else candidate.get('source_frame_path')
        data, _ = self.load_frame(path, asset_id=association['asset_id'], filename=association['filename'])
        if not data or len(data) > 25 * 1024 * 1024:
            raise HTTPException(404, 'Recorded frame bytes are unavailable or exceed the image limit.')
        try:
            with Image.open(io.BytesIO(data)) as image:
                if image.width * image.height > 40_000_000:
                    raise ValueError()
                dimensions = {'width': image.width, 'height': image.height}
                image.verify()
        except Exception:
            raise HTTPException(422, 'Recorded frame is not a supported image.') from None
        return data, dimensions

    def segment_cached_frame(self, provider, data, prompt, metadata, session, retry_failures):
        # Reuse inference only for the exact authorized physical frame and bytes.
        # Candidate association is rebuilt by inspect(), never copied from this raw cache.
        key=(session,provider.model_id,prompt,metadata['asset_id'],metadata['frame_index'],metadata['frame_filename'],metadata['timestamp_sec'],metadata['image_sha256'])
        while True:
            with self.lock:
                cached=self.raw_frames.get(key)
                if cached and self.clock()-cached[0]<self.ttl and (not retry_failures or cached[1].get('validation_status') in ('VALIDATED','NO_OBJECTS_DETECTED')):
                    return {**deepcopy(cached[1]),'workspace_frame_reused':True}
                event=self.frame_inflight.get(key)
                if event is None:
                    event=threading.Event();self.frame_inflight[key]=event
                    owner=True
                else:owner=False
            if owner:break
            event.wait()
        try:
            with self.inference_slots:
                raw=provider.segment_frame(data,prompt,metadata=metadata).model_dump(mode='json')
            prepared=raw.get('operational_metadata',{}).get('prepared_dimensions')
            invalid=raw.get('model_id')!=provider.model_id or (raw.get('validation_status')=='NO_OBJECTS_DETECTED' and bool((raw.get('raw_grammar') or '').strip()))
            if raw.get('validation_status')=='VALIDATED':
                invalid=invalid or not raw.get('objects') or any(normalized_box(obj.get('box')) is None or (prepared and ((obj.get('box') or {}).get('w')!=prepared.get('width') or (obj.get('box') or {}).get('h')!=prepared.get('height'))) for obj in raw.get('objects',[]))
            if invalid:raw['validation_status']='FAILED_VALIDATION'
            with self.lock:
                self.raw_frames[key]=(self.clock(),deepcopy(raw))
                while len(self.raw_frames)>128:self.raw_frames.popitem(last=False)
            return raw
        except Exception:
            raw={'model_id':provider.model_id,'objects':[],'validation_status':'FAILED_VALIDATION','operational_metadata':{'failure_type':'PROVIDER_API_ERROR'}}
            with self.lock:
                self.raw_frames[key]=(self.clock(),raw)
                while len(self.raw_frames)>128:self.raw_frames.popitem(last=False)
            return raw
        finally:
            with self.lock:
                self.frame_inflight.pop(key,None)
                event.set()

    def inspect(self, incident_id, candidate_id, session, prompt, run=False, only_targets=None, retry_failures=True):
        prompt = prompt.strip()
        if not prompt or len(prompt) > 200:
            raise HTTPException(422, 'An object prompt of 1–200 characters is required.')
        pair, frame, candidate = self.resolve(incident_id, candidate_id, session)
        provider = self.provider()
        key = (session, candidate_id, provider.model_id, prompt)
        lock_key=(*key,tuple(only_targets or ('reference','suspect')))
        with self.lock:
            if lock_key in self.inflight:
                raise HTTPException(409, 'This candidate and prompt are already being investigated.')
            if run:
                self.inflight.add(lock_key)
        try:
            targets = {}
            for target in (only_targets or ('reference', 'suspect')):
                association = {**pair[target], 'incident_id': incident_id, 'candidate_id': candidate_id, 'frame_match_index': pair['frame_match_index'], 'evidence_id': pair['evidence_id'], 'target': target}
                try:
                    data, dimensions = self.frame_bytes(pair, frame, candidate, target)
                except HTTPException as exc:
                    targets[target] = {'association': association, 'status': 'UNAVAILABLE', 'error': exc.detail, 'objects': []}
                    continue
                image_hash = hashlib.sha256(data).hexdigest()
                cache_key = (*key, target, image_hash)
                with self.lock:
                    now = self.clock()
                    for old_key in list(self.cache):
                        if now - self.cache[old_key][0] >= self.ttl:
                            del self.cache[old_key]
                    cached = deepcopy(self.cache.get(cache_key, (None, None))[1])
                if cached and (not run or cached['status'] in ('VALIDATED', 'NO_OBJECTS_DETECTED')):
                    cached['reused'] = cached['status'] in ('VALIDATED', 'NO_OBJECTS_DETECTED')
                    targets[target] = cached
                    continue
                if not run:
                    targets[target] = {'association': association, 'status': 'NOT_RUN', 'objects': [], 'original_dimensions': dimensions}
                    continue
                metadata = {**association, 'asset_id': association['asset_id'], 'frame_index': association['frame_id'], 'frame_filename': association['filename'], 'image_sha256': image_hash}
                try:
                    raw = self.segment_cached_frame(provider,data,prompt,metadata,session,retry_failures)
                    status = raw.get('validation_status')
                    if raw.get('model_id') != provider.model_id or (status == 'NO_OBJECTS_DETECTED' and (raw.get('raw_grammar') or '').strip()) or status not in ('VALIDATED', 'NO_OBJECTS_DETECTED', 'FAILED_VALIDATION'):
                        status = 'FAILED_VALIDATION'
                    prepared = raw.get('operational_metadata', {}).get('prepared_dimensions')
                    objects = []
                    rejected = 0
                    for obj in raw.get('objects', [])[:100]:
                        coords = normalized_box(obj.get('box'))
                        box = obj.get('box') or {}
                        if coords is None or (prepared and (box.get('w') != prepared.get('width') or box.get('h') != prepared.get('height'))):
                            rejected += 1
                            continue
                        # Object IDs are scoped to this result; tracking_id is intentionally excluded.
                        objects.append({k: obj.get(k) for k in ('object_id', 'label', 'box', 'mask', 'confidence_score') } | {'normalized_box': coords})
                    if rejected or (status == 'VALIDATED' and not objects):
                        status = 'FAILED_VALIDATION'
                    category = raw.get('operational_metadata', {}).get('failure_type')
                    safe_category = category if category in ('API_TIMEOUT', 'AUTHENTICATION_ERROR', 'RATE_LIMIT_EXCEEDED', 'CONNECTION_ERROR', 'PROVIDER_API_ERROR', 'INVALID_IMAGE', 'INVALID_MODEL_OVERRIDE') else 'OUTPUT_VALIDATION_FAILED'
                    result = {'association': association, 'status': status, 'objects': objects,
                        'prompt': prompt, 'provider': provider.provider_name, 'model_id': raw.get('model_id'),
                        'original_dimensions': dimensions, 'prepared_dimensions': raw.get('operational_metadata', {}).get('prepared_dimensions'),
                        'image_sha256': image_hash, 'reused': raw.get('workspace_frame_reused',False), 'tracking_supported': False,
                        'mask_decoding': 'UNAVAILABLE_RAW_PRESERVED', 'rejected_objects': rejected, 'objects_truncated': len(raw.get('objects', [])) > 100,
                        'latency_ms': raw.get('operational_metadata', {}).get('latency_ms'),
                        'error': f'SAM failed: {safe_category}. Retry explicitly.' if status == 'FAILED_VALIDATION' else None}
                except Exception:
                    result = {'association': association, 'status': 'FAILED_VALIDATION', 'objects': [], 'error': 'SAM provider request failed. Retry explicitly.', 'provider': provider.provider_name, 'model_id': provider.model_id, 'prompt': prompt, 'original_dimensions': dimensions}
                targets[target] = result
                # Keep sanitized failed outcomes inspectable, but never reuse them to skip an explicit retry.
                with self.lock:
                    self.cache[cache_key] = (self.clock(), deepcopy(result))
                    while len(self.cache) > self.limit:
                        self.cache.popitem(last=False)
            return {'candidate': pair, 'targets': targets, 'tracking_supported': False, 'correspondence_supported': False, 'cache_scope': 'single-process, 30-minute TTL; no database writes'}
        finally:
            if run:
                with self.lock:
                    self.inflight.discard(lock_key)


    def read_cached_context(self, incident, session):
        """Authorized callers supply an already-read incident. No frame or provider I/O.

        Snapshots describe validated historical bytes, not a fresh image verification.
        Expired entries are skipped without pruning or mutating the cache.
        """
        current = {pair['candidate_id']: pair for pair, _, _ in candidate_queue(incident, self.threshold())}
        now = self.clock()
        observations = []
        seen = set()
        with self.lock:
            cached = list(self.auto_cache.items())
        for key, (created, result) in reversed(cached):
            pair = result.get('candidate') or {}
            cid = pair.get('candidate_id')
            if key[0] != session or now-created >= self.ttl or cid in seen or cid not in current:
                continue
            if pair != current[cid]:
                continue
            seen.add(cid)
            for target, observation in (result.get('targets') or {}).items():
                association = observation.get('association') or {}
                expected = {**pair[target], 'incident_id': incident.get('incident_id'), 'candidate_id': cid,
                            'frame_match_index': pair['frame_match_index'], 'target': target, 'evidence_id': pair['evidence_id']}
                if association != expected:
                    continue
                status = observation.get('status')
                labels = [str(obj.get('label', ''))[:60] for obj in observation.get('objects', [])[:20]
                          if isinstance(obj, dict) and obj.get('label')] if status in ('VALIDATED','PARTIAL') else []
                observations.append({'candidate_id': cid, 'frame_match_index': pair['frame_match_index'],
                    'rank': pair['rank'], 'target': target, 'timestamp_sec': association.get('timestamp_sec'),
                    'source_asset_id': pair['reference']['asset_id'], 'status': status,
                    'labels': labels, 'model_id': observation.get('model_id'),
                    'discovery_model': observation.get('discovery_model'), 'tracking_supported': False})
        return {'availability': 'CACHED_SNAPSHOT' if observations else 'UNAVAILABLE_OR_EXPIRED',
                'observations': observations[:40], 'truncated': len(observations)>40,
                'limitation': 'In-memory observations of previously validated frames; no fresh inference or image check. No cross-frame identity, tracking or mask decoding. Missing cache does not mean SAM never ran.'}

    def automatic(self, incident_id, candidate_id, session, discover, retry=False):
        """One bounded discovery pass, then SAM only for actually proposed per-image concepts."""
        pair, frame, candidate = self.resolve(incident_id, candidate_id, session)
        images, dimensions = {}, {}
        for target in ('reference', 'suspect'):
            images[target], dimensions[target] = self.frame_bytes(pair, frame, candidate, target)
        hashes = {target: hashlib.sha256(data).hexdigest() for target,data in images.items()}
        key = (session, candidate_id, discover.model_id, self.provider().model_id, *hashes.values(), 'scene-v1')
        with self.lock:
            failed = self.auto_errors.get(key)
            if failed is not None and self.clock()-failed[0] < self.ttl and not retry:
                raise HTTPException(502, 'Automatic object discovery unavailable. Retry explicitly.', headers={'X-SAM-Failure-Code':failed[1],'Access-Control-Expose-Headers':'X-SAM-Failure-Code'})
            existing = self.auto_cache.get(key)
            if existing and self.clock()-existing[0] < self.ttl and (not retry or all(t['status'] in ('VALIDATED','NO_OBJECTS_DETECTED','NO_OBJECT_CONCEPTS') for t in existing[1]['targets'].values())):
                result=deepcopy(existing[1])
                for observation in result['targets'].values():observation['reused']=True
                return result
            if key in self.inflight:raise HTTPException(409, 'Automatic investigation is already in progress.')
            self.inflight.add(key)
        try:
            if existing and self.clock()-existing[0] < self.ttl:
                concepts=existing[1]['concepts']
            else:
                with self.discovery_slots:
                    concepts=discover(images['reference'], images['suspect'])
            if set(concepts) != {'reference','suspect'} or any(not isinstance(labels,list) or len(labels)>4 or any(not isinstance(label,str) or not label.strip() or len(label)>60 for label in labels) for labels in concepts.values()):
                raise ValueError('Invalid automatic concept response.')
            tasks={target:[self.concept_pool.submit(self.inspect,incident_id,candidate_id,session,concept,run=True,only_targets=(target,),retry_failures=retry) for concept in concepts[target]] for target in ('reference','suspect')}
            targets={}
            for target in ('reference','suspect'):
                observations=[future.result()['targets'][target] for future in tasks[target]]
                objects=[]
                for observation in observations:
                    if observation['status']=='VALIDATED' and observation.get('image_sha256')==hashes[target]:
                        for obj in observation['objects']:
                            objects.append({**obj,'label':observation['prompt'],'label_source':'Muse vision concept localized by SAM'})
                failures=any(o['status'] not in ('VALIDATED','NO_OBJECTS_DETECTED') or o.get('image_sha256')!=hashes[target] for o in observations)
                status='PARTIAL' if failures and objects else 'FAILED_VALIDATION' if failures else 'VALIDATED' if objects else 'NO_OBJECTS_DETECTED' if observations else 'NO_OBJECT_CONCEPTS'
                association={**pair[target],'incident_id':incident_id,'candidate_id':candidate_id,'frame_match_index':pair['frame_match_index'],'target':target,'evidence_id':pair['evidence_id']}
                targets[target]={'association':association,'status':status,'objects':objects,'original_dimensions':dimensions[target],
                    'prepared_dimensions':next((o.get('prepared_dimensions') for o in observations if o.get('prepared_dimensions')),None),
                    'image_sha256':hashes[target],'provider':self.provider().provider_name,'model_id':self.provider().model_id,
                    'discovery_model':discover.model_id,'prompt':'Automatic salient-object discovery','reused':bool(observations) and all(o.get('reused') for o in observations),
                    'concept_results':[{'label':c,'status':o['status'],'error':o.get('error')} for c,o in zip(concepts[target],observations)],
                    'error':'Some categories could not be localized. Retry explicitly.' if failures else None,
                    'mask_decoding':'UNAVAILABLE_RAW_PRESERVED','tracking_supported':False}
            result={'candidate':pair,'targets':targets,'concepts':concepts,'tracking_supported':False,'correspondence_supported':False}
            with self.lock:
                self.auto_errors.pop(key,None)
                self.auto_cache[key]=(self.clock(),deepcopy(result))
                while len(self.auto_cache)>32:self.auto_cache.popitem(last=False)
            return result
        except HTTPException:
            raise
        except Exception as error:
            from app.sam_scene import SceneDiscoveryError
            category=error.category if isinstance(error,SceneDiscoveryError) else 'INVALID_SCENE_RESPONSE'
            with self.lock:
                self.auto_errors[key]=(self.clock(),category)
                while len(self.auto_errors)>32:self.auto_errors.popitem(last=False)
            raise HTTPException(502,'Automatic object discovery unavailable. Retry explicitly.',headers={'X-SAM-Failure-Code':category,'Access-Control-Expose-Headers':'X-SAM-Failure-Code'}) from None
        finally:
            with self.lock:self.inflight.discard(key)
