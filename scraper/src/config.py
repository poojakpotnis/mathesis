import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

API_URL = os.environ.get("MATHESIS_API_URL", "http://localhost:3000")
API_KEY = os.environ.get("MATHESIS_API_KEY", "")
RSM_BASE_URL = os.environ.get("RSM_BASE_URL", "https://student.russianschool.com")
HOMEWORK_LIST_URL = f"{RSM_BASE_URL}/student-portal/content/homework"

BROWSER_STATE_DIR = Path(__file__).parent.parent / "storage" / "browser_state"

# CSS selectors for the new RSM student portal (student.russianschool.com).
# Confirmed against dumped DOM on 2026-08-29 (see storage/new_portal_*.html).
SELECTORS = {
    # Left-panel problem map on the assignment page. Each button is one problem;
    # its inner .assignment-item-text carries the label (e.g. "19", "51a", "224b").
    "problems_map_items": "[data-qa='assignment-item-selector-btn']",
    "problems_map_item_label": ".assignment-item-text",
    # Main problem content shown in the right pane. Subpart problems have BOTH:
    #   - question-problem = the umbrella instruction ("Calculate.")
    #   - question-subproblem = the specific expression for this subpart
    # We extract and concatenate both so 224a and 224b end up distinguishable.
    "problem_question": "[data-qa='question-problem']",
    "problem_subproblem": "[data-qa='question-subproblem']",
    "problem_images": "[data-qa='question-problem'] img, [data-qa='question-subproblem'] img, .assignment-question img",
    # Answer inputs — best-effort; not all problem types expose the same shape.
    "answer_input": ".answer input, .answer textarea",
    # Auth / route detection.
    "login_indicator": "input[type='password']",
    # Top-nav elements present on every authenticated page (list + assignment).
    # The homework-list page lacks [data-app='student-portal'], so we can't rely on it alone.
    "authenticated_indicator": "[data-qa='student-portal-logo-btn'], [data-qa='user-avatar'], [data-app='student-portal']",
    # Assignment-page metadata (the "Homework 1 | ..." header).
    "assignment_title": "[data-qa='assignment-title']",
}

LOGIN_TIMEOUT_SECONDS = 300
NAV_TIMEOUT_MS = 45000
