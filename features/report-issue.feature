Feature: Report Issue to Upstream
  As a fork maintainer
  I want to report issues to the upstream repository
  So that bugs and problems can be tracked and fixed

  Scenario: Successfully report issue with gh CLI authentication
    Given .agile-flow-meta/upstream exists with valid GitHub URL
    And gh CLI is authenticated with write access to upstream
    When user runs report-issue.sh with valid inputs
    Then exit code is 0
    And issue is created in upstream repo with label downstream-report
    And report file is saved to .agile-flow-meta/reports/

  Scenario: Fallback to manual submission when gh CLI fails
    Given .agile-flow-meta/upstream exists with valid GitHub URL
    And gh CLI is not available or authentication fails
    When user runs report-issue.sh with valid inputs  
    Then exit code is 0
    And report file is saved to .agile-flow-meta/reports/
    And fallback URL is provided for manual submission