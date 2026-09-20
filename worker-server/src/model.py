from typing import Iterable
import numpy as np

from piper.voice import AudioChunk



class Model:
    def __init__(self) -> None:
        pass

    def generate(self, text: str) -> Iterable[AudioChunk]:
        return iter(())

    async def connect_livekit(self, url: str, token: str) -> None:
        pass

    async def push(self, audio: AudioChunk, room: str) -> None:
        pass

    async def synthesize_and_publish(self, text: str) -> bool:
        return False
