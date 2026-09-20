import asyncio
import json
import os
import signal
import uuid
from typing import Any
import redis.asyncio as aioredis
from livekit import rtc
from piper_tts import PIPER

# Configuration passed via env vars by the Pod Cluster Manager
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
QUEUE_NAME = os.getenv("JOB_QUEUE", "queue:tts:piper")


class WorkerPod:

    def __init__(self, model_class=PIPER):
        self.redis: Any = None
        self.running = True
        self.model_class = model_class
        self.id = str(uuid.uuid4())

        # Dynamic ID unique to this specific instance
        self.pod_id = f"pod-{os.getenv('POD_NAME', 'worker')}-{self.id[:6]}"
        self.default_model_path = os.getenv(
            "PIPER_MODEL_PATH", "models/en_US-lessac-medium.onnx"
        )

    async def start(self):
        try:
            self.redis = aioredis.from_url(REDIS_URL, decode_responses=True)
            print(f"[{self.pod_id}] Online. Subscribing to queue: {QUEUE_NAME}")
        except Exception as conn_err:
            print(f"[{self.pod_id}] Failed to connect to Redis: {conn_err}")
            self.running = False
            return

        heartbeat_task = asyncio.create_task(self._heartbeat_loop())

        try:
            while self.running:
                try:
                    # BLPOP blocks until a job is available
                    result = await self.redis.blpop(QUEUE_NAME, timeout=2)
                    if result:
                        _, job_data = result
                        try:
                            job = json.loads(job_data)
                            await self._process_job(job)
                        except Exception as err:
                            print(
                                f"[{self.pod_id}] Error parsing or processing job: {err}"
                            )
                except asyncio.CancelledError:
                    break
                except Exception as redis_err:
                    print(
                        f"[{self.pod_id}] Redis connection or polling error: {redis_err}. Retrying in 2s..."
                    )
                    await asyncio.sleep(2)
        finally:
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass
            await self._cleanup()

    async def _process_job(self, job):
        room_name = job.get("room_name", "test-room")
        text = job.get(
            "text", "Hello, this is a test of the streaming Piper TTS engine."
        )

        tts = self.model_class()

        try:
            print(
                f"[{self.pod_id}] Connecting to LiveKit room '{room_name}'..."
            )
            await tts.connect(room_name)
            print(f"[{self.pod_id}] Synthesizing speech...")
            success = await tts.synthesize_and_publish(text)

            if success:
                while not tts.is_free:
                    await asyncio.sleep(0.1)
                print(f"[{self.pod_id}] Audio stream finished successfully.")
            else:
                print(f"[{self.pod_id}] Failed to dispatch synthesis task.")

        except Exception as e:
            print(f"[{self.pod_id}] Exception during job execution: {e}")

        finally:
            try:
                await tts.close()
            except Exception as close_err:
                print(
                    f"[{self.pod_id}] Error during tts close: {close_err}"
                )

    async def _heartbeat_loop(self):
        """Informs the cluster manager/redis that this pod is alive."""
        while self.running:
            try:
                if self.redis is not None:
                    await self.redis.hset("active_pods", self.pod_id, "alive")
                    await self.redis.expire("active_pods", 10)
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[{self.pod_id}] Heartbeat failed: {e}")
            await asyncio.sleep(5)

    async def stop(self):
        """Graceful shutdown triggered by manager signal."""
        print(f"[{self.pod_id}] Shutdown signal received. Stopping worker...")
        self.running = False

    async def _cleanup(self):
        if self.redis:
            try:
                await self.redis.hdel("active_pods", self.pod_id)
                await self.redis.aclose()
            except Exception as e:
                print(f"[{self.pod_id}] Cleanup error: {e}")
        print(f"[{self.pod_id}] Off-line and cleaned up.")


async def main():
    pod = WorkerPod()

    if os.name != "nt":
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(
                sig, lambda: asyncio.create_task(pod.stop())
            )

    try:
        await pod.start()
    except (KeyboardInterrupt, asyncio.CancelledError):
        print(f"[{pod.pod_id}] Shutdown requested via keyboard/signal...")
        await pod.stop()


if __name__ == "__main__":
    asyncio.run(main())