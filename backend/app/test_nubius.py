import os
from dotenv import load_dotenv
from app.providers import factory as provider_factory
load_dotenv()

provider = provider_factory.get_reasoning_provider()
model = provider.model_id

response = provider.create_text_completion(
    request=dict(
        model=model,
        messages=[
            {
                "role": "system",
                "content": "You are a helpful Python debugging assistant."
            },
            {
                "role": "user",
                "content": (
                    "Explain this bug in two sentences: "
                    "a function returns the wrong result "
                    "because it uses >= instead of >."
                ),
            },
        ],
        max_tokens=300,
    )
)

print(response)