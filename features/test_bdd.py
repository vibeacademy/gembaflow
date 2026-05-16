"""BDD test runner for coverage measurement."""

from pytest_bdd import scenarios

# Import step definitions so they're available
from features.steps import report_issue_steps  # noqa: F401

# Load scenarios - path is relative to this file's directory
scenarios("report-issue.feature")
