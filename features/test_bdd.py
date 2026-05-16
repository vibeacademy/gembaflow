"""BDD test runner for coverage measurement."""
from pytest_bdd import scenarios

# Import step definitions so they're available
from features.steps import report_issue_steps  # noqa: F401

# This will generate test functions from scenarios in the feature file
scenarios('../report-issue.feature')