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
    grade_level: int | None = None
    # 'homework' = the one-per-lesson homework; 'classwork' = one of many
    # topic-scoped classwork assignments. Homework updates lesson-level
    # metadata; classwork attaches problems without touching title/grade.
    source: str = "homework"
    source_assignment_id: str | None = None
    source_assignment_title: str | None = None
    problems: list[ScrapedProblem]
