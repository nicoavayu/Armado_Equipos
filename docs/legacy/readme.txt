# Post-Match Survey and Awards Feature Documentation

## Overview
The post-match survey and awards system automatically collects player feedback after matches, calculates player awards based on votes, and displays achievements in player profiles. This feature enhances player engagement and provides valuable data on match quality and player performance.

## New Files and Components

### Components
- **PostMatchSurvey.js / PostMatchSurvey.css**
  - Modal component that displays the survey form
  - Collects data on match quality, player attendance, MVP votes, goalkeeper performance, and fair play
  - Handles submission and notification updates

- **PlayerAwards.js / PlayerAwards.css**
  - Displays player awards in profile cards
  - Shows MVP, goalkeeper, and fair play awards with counts
  - Renders different award types with appropriate icons

- **SurveyManager.js**
  - Manages survey state and display logic
  - Coordinates between notification system and survey components
  - Controls when surveys appear to users

### Hooks
- **useSurveys.js**
  - Custom hook for managing survey state
  - Checks for pending surveys
  - Handles survey submission and results processing
  - Provides survey-related functions to components

- **useSurveyScheduler.js**
  - Hook that initializes and manages the survey scheduler
  - Sets up periodic checks for matches that need surveys
  - Runs on app startup and at regular intervals

### Services
- **surveyService.js**
  - Core service for survey functionality
  - Creates survey notifications
  - Checks for pending surveys
  - Processes survey results and calculates awards
  - Updates player responsibility scores

- **surveyScheduler.js**
  - Handles automatic survey scheduling
  - Checks for recently ended matches
  - Creates survey notifications for eligible matches
  - Marks matches as having surveys sent

## Integration with Existing App

### App.js Integration
- Imports and initializes the survey scheduler
- Adds survey-related context providers
- Connects survey notifications to the notification system

### Component Updates
- **ProfileCard.js / ProfileCardModal.js**
  - Updated to display player awards and responsibility score
  - Integrates PlayerAwards component

- **NotificationsView.js**
  - Updated to handle survey notifications
  - Provides option to open surveys directly from notifications

- **VotingView.js**
  - Connected to survey system for consistent player evaluation
  - Shares data structures with survey components

### Hook and Service Connections
- **NotificationContext.js**
  - Extended to handle survey notifications
  - Provides survey-specific notification handling

- **useProfile.js**
  - Updated to fetch and display player awards and responsibility scores

## Automatic Survey Notification System

### Notification Trigger
- The system automatically checks for matches that have ended within the last hour
- Uses the `hora_fin` timestamp field to determine when matches end
- Runs checks every 5 minutes via the survey scheduler

### Survey Alert Logic
1. `checkMatchesForSurveys()` identifies recently ended matches
2. Checks if surveys have already been sent (`surveys_sent` field)
3. Creates notifications for all players in eligible matches
4. Marks matches as having surveys sent to prevent duplicates

### Notification Integration
- Integrates with the existing notification system
- Creates notifications of type 'post_match_survey'
- Includes match details and survey instructions
- Appears in the notification center with other app notifications

## Survey Completion Check Logic

### Duplicate Prevention
1. When a user receives a survey notification, the system checks if they've already completed it
2. `checkPendingSurveys()` queries the `post_match_surveys` table for existing submissions
3. If a submission exists, the notification is marked as read
4. If no submission exists, the survey is added to pending surveys

### UI Trigger Points
- Notification center: Users can click survey notifications to open the survey
- Match details: Survey button appears for matches needing feedback
- App startup: Checks for pending surveys and prompts users

## Award Calculation and Storage

### Calculation Process
1. `processSurveyResults()` is called after survey submissions
2. Collects all surveys for a specific match
3. Counts votes for each category (MVP, goalkeeper, fair play)
4. Determines winners based on vote counts
5. Creates award records in the database

### Award Types
- **MVP**: Players with most votes from each team
- **Best Goalkeeper**: Player with most goalkeeper votes
- **Negative Fair Play**: Players with significant negative votes (>25% of surveys)

### Storage and Display
- Awards are stored in the `player_awards` table
- Each award links to a player and match
- PlayerAwards component fetches and displays awards in player profiles

## Responsibility Score System

### Score Updates
- **Decrease**: Players marked absent have their score reduced by 0.5 (minimum 1)
- **Increase**: Players who complete surveys have their score increased by 0.1 (maximum 10)

### Display and Usage
- Scores are displayed in player profiles
- Used for team balancing and player reliability metrics
- Visible to admins and team organizers

## Database Changes

### New Tables
- **post_match_surveys**: Stores survey submissions
  - Fields: partido_id, votante_id, se_jugo, asistieron_todos, etc.

- **player_awards**: Stores player awards
  - Fields: jugador_id, award_type, partido_id

### Modified Tables
- **partidos**: Added fields:
  - `surveys_sent` (boolean): Tracks if surveys were sent
  - `hora_fin` (timestamp): Records when matches end

- **jugadores**: Added field:
  - `responsabilidad_score` (numeric): Player responsibility rating

- **notifications**: Extended to support survey notifications
  - Uses existing structure with type 'post_match_survey'

## Testing Checklist

### Test Route
A dedicated test route has been added to manually test the post-match survey feature:

- **URL**: `/test-survey` or `/test-survey/:partidoId/:userId`
- **Purpose**: Allows developers to manually open and test the survey for any match and user
- **Features**:
  - Enter match ID and user ID manually or via URL parameters
  - Validates if survey already exists for the user/match combination
  - Shows match details before opening the survey
  - Fully functional survey submission that persists to the database

### Survey Creation
1. Create and complete a match
2. Verify survey notifications are sent to all players
3. Check that the match is marked as having surveys sent

### Survey Completion
1. Log in as a player who participated in a match
2. Verify survey notification appears
3. Complete the survey with different selections
4. Verify the notification is marked as read

### Award Calculation
1. Submit multiple surveys with consistent votes
2. Check that awards are correctly assigned
3. Verify MVP, goalkeeper, and fair play awards appear in profiles

### Responsibility Scores
1. Mark players as absent in surveys
2. Verify their responsibility scores decrease
3. Complete surveys as different players
4. Verify their responsibility scores increase

### Edge Cases
1. Test with matches that have no teams defined
2. Test with matches that have no goalkeepers
3. Test with players who are in multiple matches
4. Test survey submission with incomplete data