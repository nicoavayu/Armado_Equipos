# Amigos (Friends) Functionality

This document explains how to use the friends functionality in the Team Balancer app.

## Database Setup

1. Run the SQL script in `AMIGOS-TABLE-SETUP.sql` in your Supabase SQL editor to create the necessary table and policies.

## Features

- **Friend Requests**: Users can send friend requests to other players
- **Accept/Reject**: Users can accept or reject incoming friend requests
- **Remove Friends**: Users can remove existing friendships
- **Private Data**: Only friends can see each other's private data (phone, email, location)
- **Friends List**: Users can see all their accepted friends in the Amigos tab

## Components

### useAmigos Hook

The `useAmigos` hook provides all the functionality for managing friendships:

```jsx
import { useAmigos } from '../hooks/useAmigos';

const MyComponent = () => {
  const { 
    amigos,                // List of accepted friends
    loading,               // Loading state
    error,                 // Error state
    getAmigos,             // Function to get all friends
    getRelationshipStatus, // Function to check relationship with a player
    sendFriendRequest,     // Function to send a friend request
    acceptFriendRequest,   // Function to accept a friend request
    rejectFriendRequest,   // Function to reject a friend request
    removeFriend,          // Function to remove a friend
    getPendingRequests     // Function to get pending friend requests
  } = useAmigos(currentUserId);
  
  // Your component logic here
};
```

### ProfileCard Component

The `ProfileCard` component has been updated to show friend action buttons and private data:

```jsx
import ProfileCard from './components/ProfileCard';

// In your component:
<ProfileCard 
  profile={playerProfile} 
  isVisible={true} 
  enableTilt={true}
  currentUserId={currentUserId}
  showFriendActions={true}
/>
```

### AmigosView Component

The `AmigosView` component displays the friends list and pending requests:

```jsx
import AmigosView from './components/AmigosView';

// In your component:
<AmigosView />
```

## Usage Examples

### Checking Relationship Status

```jsx
const { getRelationshipStatus } = useAmigos(currentUserId);

useEffect(() => {
  const checkRelationship = async () => {
    const status = await getRelationshipStatus(otherPlayerId);
    if (status) {
      console.log('Relationship status:', status.status);
    } else {
      console.log('No relationship exists');
    }
  };
  
  checkRelationship();
}, [otherPlayerId]);
```

### Sending a Friend Request

```jsx
const { sendFriendRequest } = useAmigos(currentUserId);

const handleAddFriend = async () => {
  const result = await sendFriendRequest(otherPlayerId);
  
  if (result.success) {
    toast.success('Solicitud de amistad enviada');
  } else {
    toast.error(result.message || 'Error al enviar solicitud');
  }
};
```

### Accepting a Friend Request

```jsx
const { acceptFriendRequest } = useAmigos(currentUserId);

const handleAcceptRequest = async (requestId) => {
  const result = await acceptFriendRequest(requestId);
  
  if (result.success) {
    toast.success('Solicitud de amistad aceptada');
  } else {
    toast.error(result.message || 'Error al aceptar solicitud');
  }
};
```

## Implementation Notes

- The `amigos` table has a unique constraint on `(user_id, friend_id)` to prevent duplicate relationships
- Row Level Security (RLS) policies ensure users can only see and modify their own friendships
- The `status` field can be one of: `pending`, `accepted`, or `rejected`
- When a user is deleted, all their friendships are automatically deleted (CASCADE)