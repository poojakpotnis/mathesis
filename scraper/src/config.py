import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

API_URL = os.environ.get("MATHESIS_API_URL", "http://localhost:3000")
API_KEY = os.environ.get("MATHESIS_API_KEY", "")
RSM_BASE_URL = os.environ.get("RSM_BASE_URL", "https://homework.russianschool.com")

BROWSER_STATE_DIR = Path(__file__).parent.parent / "storage" / "browser_state"

# CSS selectors for RSM portal elements.
# Confirmed against the live portal via `discover` on 2026-05-25.
SELECTORS = {
    # Sidebar problem map — each `<a class="problem_number">` is one navigable item.
    # The first item often has class `text_number` and contains "TH" (a label, not a problem).
    "problems_map_items": ".problems-map a.problem_number",
    "problems_map_label_class": "text_number",  # filter: skip items with this class
    # Main problem content.
    "problem_question": ".problem-right-part .problem-question",
    "problem_right_part": ".problem-right-part",
    "problem_section": ".problem-section",
    "problem_label": ".problem-label",  # carries credit classes (score-100, correct, etc)
    # Images inside the problem area.
    "problem_images": ".problem-right-part img, .problem-section img",
    # Hint button (text shown when revealed).
    "hint_button": "button.btn-hint",
    # Answer inputs.
    "answer_textarea": ".problem-section textarea:not(.comment_text)",
    "answer_input": ".problem-section input[type='text'], .problem-section input[type='number']",
    # Lesson title — first link/element containing "Lesson <N>".
    "lesson_title": "a:has-text('Lesson')",
    # Login detection.
    "login_indicator": "input[type='password']",
    "authenticated_indicator": ".problems-map, [class*='assignment'], [class*='homework']",
}

LOGIN_TIMEOUT_SECONDS = 300
NAV_TIMEOUT_MS = 15000
