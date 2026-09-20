import asyncio
import os
from typing import Iterable
import dotenv

from piper import PiperVoice
from piper.voice import AudioChunk
from livekit import rtc, api
from model import Model

dotenv.load_dotenv()


class PIPER(Model):
    def __init__(self, model_path: str = "models/en_US-lessac-medium.onnx", sample_rate: int = 22050, channels: int = 1) -> None:
        super().__init__()
        self.name = "piper-tts"
        self.sample_rate = sample_rate
        self.channels = channels
        self.is_free = True

        self.voice = PiperVoice.load(model_path)
        self._url = os.getenv("LIVEKIT_URL", "wss://your-livekit-instance.livekit.cloud")
        self._key = os.getenv("LIVEKIT_APIKEY", "devkey")
        self._secret = os.getenv("API_SECRETE", "secret")


        self.room = rtc.Room()
        self.audio_source = rtc.AudioSource(self.sample_rate, self.channels)
        self.track = rtc.LocalAudioTrack.create_audio_track(self.name, self.audio_source)

    def _token(self, room_name: str) -> str:
        return (
            api.AccessToken(self._key, self._secret)
            .with_identity("piper-worker")
            .with_grants(api.VideoGrants(room_join=True, room=room_name))
            .to_jwt()
        )

    async def connect(self, room_name: str) -> None:
        """Connects persistently to the target LiveKit room."""
        self.room_name = room_name
        await self.room.connect(self._url, self._token(room_name))
        await self.room.local_participant.publish_track(self.track)

    async def push(self, audio: AudioChunk , room: str) -> None:
        """Pushes raw PCM bytes straight to LiveKit AudioSource."""
        pcm_bytes = audio.audio_int16_bytes
        frame = rtc.AudioFrame(
            data=pcm_bytes,
            sample_rate=audio.sample_rate or self.sample_rate,
            num_channels=self.channels,
            samples_per_channel=len(pcm_bytes) // (2 * self.channels),
        )
        await self.audio_source.capture_frame(frame)

    async def synthesize_and_publish(self, text: str) -> bool:
        """Non-blocking fire-and-forget generation task."""
        if not text.strip() or not self.is_free:
            return False

        asyncio.create_task(self._stream(text, self.room_name))
        return True

    async def _stream(self, text: str, room: str) -> None:
        self.is_free = False
        loop = asyncio.get_running_loop()
        try:
            # Stream directly rather than storing intermediate lists
            chunks: Iterable[AudioChunk] = await loop.run_in_executor(None, self.voice.synthesize, text)
            for chunk in chunks:
                await self.push(chunk, room=room)
            await self.audio_source.wait_for_playout()
        except Exception as e:
            print(f"[{self.name}] Stream error: {e}")
        finally:
            self.is_free = True

    async def close(self) -> None:
        await self.room.disconnect()
        
        
