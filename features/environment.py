"""Behave environment configuration for BDD tests.

This file replaces pytest fixtures with behave hooks for setup and teardown.
"""

import shutil
from pathlib import Path


def before_scenario(context, scenario):
    """Set up before each scenario."""
    # Store original working directory
    context.original_cwd = Path.cwd()

    # Initialize temp_git_repo to None - will be created by steps that need it
    context.temp_git_repo = None
    context.test_result = None


def after_scenario(context, scenario):
    """Clean up after each scenario."""
    # Clean up temporary directory if it was created
    if hasattr(context, "temp_git_repo") and context.temp_git_repo:
        try:
            # Use shutil.rmtree since it can handle read-only files
            shutil.rmtree(str(context.temp_git_repo), ignore_errors=True)
        except Exception:
            # If cleanup fails, ignore it - temp directories will be cleaned up later
            pass

    # Restore original working directory if needed
    if hasattr(context, "original_cwd"):
        try:
            import os

            os.chdir(context.original_cwd)
        except Exception:
            pass


def before_all(context):
    """Set up before all scenarios."""
    pass


def after_all(context):
    """Clean up after all scenarios."""
    pass
