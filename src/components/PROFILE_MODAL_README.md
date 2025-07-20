# ProfileCardModal Components

This set of components provides a reusable way to display player profiles in a modal throughout the application.

## Components

### 1. ProfileCardModal

A modal component that displays a player's ProfileCard with friend action buttons.

```jsx
<ProfileCardModal 
  isOpen={isModalOpen}
  onClose={handleCloseModal}
  profile={playerProfile}
/>
```

### 2. PlayerCardTrigger

A wrapper component that makes any player item clickable to show the ProfileCardModal.

```jsx
<PlayerCardTrigger profile={playerProfile}>
  {/* Any content that should be clickable to open the modal */}
  <div className="player-item">
    <img src={playerProfile.avatar_url} alt={playerProfile.nombre} />
    <span>{playerProfile.nombre}</span>
  </div>
</PlayerCardTrigger>
```

## Usage

1. Import the components:

```jsx
import { PlayerCardTrigger } from './components/ProfileComponents';
```

2. Wrap any player item with the PlayerCardTrigger:

```jsx
{players.map(player => (
  <PlayerCardTrigger key={player.id} profile={player}>
    <YourPlayerComponent player={player} />
  </PlayerCardTrigger>
))}
```

3. The modal will automatically open when the wrapped component is clicked, showing the player's ProfileCard with appropriate friend action buttons.

## Features

- Automatically handles friend relationship status
- Shows appropriate friend action buttons based on relationship status
- Prevents showing friend actions when viewing your own profile
- Includes debug logs for troubleshooting
- Fully responsive design
- Keyboard accessible
- Closes on escape key or clicking outside

## Implementation Notes

- The modal uses the existing ProfileCard component without modifying its internal logic
- Friend action buttons are rendered below the card, not overlapping it
- The modal can be used with any player data structure that matches the ProfileCard component's expected format