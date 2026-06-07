import httpx
from rich.console import Console

from .config import API_URL, API_KEY
from .models import LessonPayload

console = Console()


class MathesisClient:
    def __init__(self, base_url: str = API_URL, api_key: str = API_KEY):
        self.client = httpx.Client(
            base_url=base_url,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30.0,
        )

    def push_lesson(self, payload: LessonPayload) -> dict:
        console.print(
            f"[cyan]Pushing lesson {payload.lesson_number} "
            f"({len(payload.problems)} problems) to {self.client.base_url}...[/cyan]"
        )
        response = self.client.post(
            "/api/ingest",
            json=payload.model_dump(),
        )
        response.raise_for_status()
        data = response.json()
        console.print(
            f"[green]Ingested lesson {payload.lesson_number}: "
            f"{data.get('problemCount', '?')} problems "
            f"({data.get('imageCount', 0)} with images).[/green]"
        )
        return data

    def get_lessons(self) -> list[dict]:
        response = self.client.get("/api/lessons")
        response.raise_for_status()
        return response.json()

    def close(self):
        self.client.close()
