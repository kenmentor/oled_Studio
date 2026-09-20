# import asyncio
# import os
# from piper_tts import PIPER # import your class from its file


# async def main():

#     tts = PIPER(model_path="models/en_US-lessac-medium.onnx")

#     try:
#         print("Connecting to LiveKit room...")
#         await tts.connect("test-room")

#         print("Synthesizing speech...")
#         success = await tts.synthesize_and_publish("Hello, this is a test of the streaming Piper TTS engine.","")
        
#         if success:
#             # Keep loop alive while worker processes audio
#             while not tts.is_free:
#                 await asyncio.sleep(0.1)
#             print("Audio stream finished successfully.")
#         else:
#             print("Failed to dispatch synthesis task.")

#     finally:
#         await tts.close()

# if __name__ == "__main__":
#     asyncio.run(main())


import asyncio
import json
import os
import uuid
import redis.asyncio as aioredis

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
QUEUE_NAME = os.getenv("JOB_QUEUE", "queue:tts:piper")

# Sample job payloads for the worker
JOBS = [
    {
        "job_id": f"job-{uuid.uuid4().hex[:6]}",
        "room_name": "test-room",
        "text": "Hello! The Piper TTS worker cluster is running and processing jobs successfully.",
    },
    {
        "job_id": f"job-{uuid.uuid4().hex[:6]}",
        "room_name": "test-room",
        "text": "This is a second test job dispatched via Redis LPUSH.",
    },
]


async def populate_queue():
    redis = aioredis.from_url(REDIS_URL, decode_responses=True)
    print(f"Connecting to Redis at {REDIS_URL}...")

    try:
        for job in JOBS:
            payload = json.dumps(job)
            # Push job onto the tail/left of the Redis queue list
            await redis.lpush(QUEUE_NAME, payload)
            print(f"[+] Pushed {job['job_id']} to queue '{QUEUE_NAME}'")

        # Check total remaining jobs in queue
        queue_length = await redis.llen(QUEUE_NAME)
        print(f"\nTotal jobs in '{QUEUE_NAME}': {queue_length}")

    finally:
        await redis.aclose()


if __name__ == "__main__":
    asyncio.run(populate_queue())