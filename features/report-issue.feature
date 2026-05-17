Feature: Report Issue to Upstream
  As a fork maintainer
  I want to report issues to the upstream repository
  So that bugs and problems can be tracked and fixed

  Scenario: Successfully report issue with gh CLI authentication
    Given .agile-flow-version exists with valid upstream URL
    And gh CLI is authenticated with write access to upstream
    When user runs report-issue.sh with valid inputs
    Then exit code is 0
    And issue is created in upstream repo with label downstream-report
    And report file is saved to .agile-flow-reports/

  Scenario: Fallback to manual submission when gh CLI fails
    Given .agile-flow-version exists with valid upstream URL
    And gh CLI is not available or authentication fails
    When user runs report-issue.sh with valid inputs  
    Then exit code is 0
    And report file is saved to .agile-flow-reports/
    And fallback URL is provided for manual submission

  Scenario: Fallback to manual submission when gh CLI lacks write access
    Given .agile-flow-version exists with valid upstream URL
    And gh CLI lacks write access to upstream (permission denied)
    When user runs report-issue.sh with valid inputs
    Then exit code is 0
    And report file is saved to .agile-flow-reports/
    And pre-filled GitHub issue URL is printed
    And report body is copied to clipboard (if available)

  # Error cases

  Scenario: Missing .agile-flow-version file
    Given .agile-flow-version does not exist
    When user runs report-issue.sh
    Then exit code is 1
    And error output suggests running /upgrade

  Scenario: Missing upstream field in .agile-flow-version
    Given .agile-flow-version exists but upstream field is missing
    When user runs report-issue.sh
    Then exit code is 1
    And error output suggests running /upgrade

  Scenario: Invalid severity value
    Given .agile-flow-version exists with valid upstream URL
    When user runs report-issue.sh with --severity invalid
    Then exit code is 1
    And error output lists valid severity values p1, p2, p3

  Scenario: Invalid component value
    Given .agile-flow-version exists with valid upstream URL
    When user runs report-issue.sh with --component invalid
    Then exit code is 1
    And error output lists valid components

  Scenario: Empty title
    Given .agile-flow-version exists with valid upstream URL
    When user runs report-issue.sh with empty title
    Then exit code is 1
    And error output indicates title is required
