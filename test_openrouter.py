import requests
import json
import sys

# Replace with the key from main.py if testing locally, or just load from main.py
try:
    with open('main.py', 'r') as f:
        content = f.read()
        key_line = [line for line in content.split('\n') if 'OPENROUTER_API_KEY' in line and '=' in line][0]
        key = key_line.split("'")[1]
except Exception as e:
    print(f"Error reading key: {e}")
    sys.exit(1)

response = requests.post(
    url="https://openrouter.ai/api/v1/chat/completions",
    headers={
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
    },
    json={
        "model": "google/gemini-1.5-pro",
        "messages": [
            {"role": "user", "content": "Test"}
        ]
    }
)
print("Status:", response.status_code)
print("Response:", response.text)
