from pydantic import BaseModel


class ScrapedProblem(BaseModel):
    problem_number: str
    display_order: int
    problem_text: str
    is_take_home: bool = False
    has_image: bool = False
    image_description: str | None = None
    hint_text: str | None = None
    answer_format_type: str | None = None
    expected_answer: str | None = None
    credit_status: str | None = None
    attempt_count: int | None = None
    score: float | None = None
    raw_html: str | None = None


class LessonPayload(BaseModel):
    lesson_number: int
    title: str
    problems: list[ScrapedProblem]
