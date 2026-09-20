import os
from livekit import api

def get_livekit_token(
    room_name: str = "test-room", 
    identity: str = "debug-user",
    api_key: str = "devkey",
    api_secret: str = "secret"
) -> str:
    """Generates a LiveKit JWT access token."""
    token = (
        api.AccessToken(api_key, api_secret)
        .with_identity(identity)
        .with_name(identity)
        .with_grants(
            api.VideoGrants(
                room_join=True,
                room=room_name,
                can_subscribe=True,
                can_publish=True,
                can_publish_data=True,
            )
        )
    )
    return token.to_jwt()

# Call it directly:
print(get_livekit_token())