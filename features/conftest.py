"""Pytest configuration for BDD tests."""
import pytest
from pytest_bdd import given, when, then, parsers, scenarios

# Import all step definitions so they're registered
from features.steps.report_issue_steps import *  # noqa: F401, F403
