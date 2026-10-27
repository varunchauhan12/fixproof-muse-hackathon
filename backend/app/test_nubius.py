import os
from dotenv import load_dotenv
from openai import OpenAI
load_dotenv()

client = OpenAI(
    base_url="https://api.tokenfactory.nebius.com/v1/",
    api_key=os.environ["NEBIUS_API_KEY"]
)

response = client.chat.completions.create(
    model=os.getenv(
        "NEBIUS_MODEL",
        "nvidia/Nemotron-3_5-Lightning"
    ),
    messages=[
        {
            "role": "system",
            "content":"You are a helpful Python debugging assistant."
        }  ,{
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

print(response.choices[0].message.content)