# Post-Match Survey Feature

This document describes the implementation of the post-match survey feature in the Team Balancer application.

## Overview

The post-match survey feature allows players to provide feedback after a match. The survey includes questions about:
- Whether the match was played
- Player attendance
- Best players on each team
- Best goalkeeper
- Fair play assessment

## Components

### 1. Database Tables

The feature uses the following tables:
- `post_match_surveys`: Stores survey responses
- `player_awards`: Stores awards based on survey results
- `jugadores`: Updated with responsibility scores
- `partidos`: Added `surveys_sent` and `hora_fin` fields

### 2. React Components

- `PostMatchSurvey.js`: The survey modal component
- `SurveyManager.js`: Manages survey display and submission
- `PlayerAwards.js`: Displays player awards in the profile

### 3. Services and Hooks

- `surveyService.js`: Functions for creating notifications and processing survey results
- `surveyScheduler.js`: Periodically checks for matches that need surveys
- `useSurveys.js`: Hook for managing survey state
- `useSurveyScheduler.js`: Hook for initializing the survey scheduler

## Flow

1. One hour after a match is scheduled to finish, the system creates notifications for all players
2. Players receive a notification to complete the post-match survey
3. When a player opens the survey, they can answer questions about the match
4. After submission, the system processes the results and updates player awards and responsibility scores
5. Player profiles display awards and updated responsibility scores

## Implementation Details

### Survey Notifications

Notifications are created automatically one hour after a match ends. The `surveyScheduler.js` service checks for matches that need surveys every 5 minutes.

### Survey Modal

The survey modal is displayed when:
1. A player clicks on a post-match survey notification
2. The system detects a pending survey when the player logs in

### Awards Processing

After surveys are submitted, the system:
1. Counts votes for each category (MVP, goalkeeper, fair play)
2. Determines winners based on vote counts
3. Creates entries in the `player_awards` table
4. Updates player responsibility scores

### Responsibility Score

Player responsibility scores are:
- Decreased when a player is reported as absent
- Increased when a player completes a survey

## Usage

The feature is designed to be non-intrusive. Players can:
- Complete the survey when prompted
- Skip the survey by closing the modal
- Access pending surveys through notifications