# Notification System Documentation

This document explains how to use the notification system in the Team Balancer app.

## Overview

The notification system provides real-time alerts for important events such as:
- Friend requests
- Match invitations
- Friend request acceptances/rejections
- Match updates

## Database Setup

Before using the notification system, you need to set up the notifications table in your Supabase database:

1. Go to your Supabase project dashboard
2. Navigate to the SQL Editor
3. Copy and paste the SQL from `src/db/notifications_table.sql`
4. Run the SQL to create the table and set up permissions

## Components

### NotificationContext

The `NotificationContext` provides global access to notifications and related functions:

```jsx
import { useNotifications } from '../context/NotificationContext';

const MyComponent = () => {
  const { 
    notifications,      // Array of all notifications
    unreadCount,        // Object with counts: { friends, matches, total }
    markAsRead,         // Function to mark a notification as read
    markAllAsRead,      // Function to mark all notifications as read
    markTypeAsRead,     // Function to mark all notifications of a type as read
    createNotification, // Function to create a new notification
    fetchNotifications  // Function to refresh notifications
  } = useNotifications();
  
  // Your component code
};
```

### NotificationBadge

The `NotificationBadge` component displays a count badge:

```jsx
import NotificationBadge from './components/NotificationBadge';

// In your component:
<div className="icon-container">
  <SomeIcon />
  <NotificationBadge count={5} />
</div>
```

### NotificationsView

The `NotificationsView` component displays a list of all notifications:

```jsx
import NotificationsView from './components/NotificationsView';

// In your component:
<NotificationsView />
```

## Creating Notifications

### Friend Request Notifications

Friend request notifications are automatically created in the `useAmigos` hook when:
- A user sends a friend request
- A user accepts a friend request
- A user rejects a friend request

### Match Notifications

Use the utility functions in `utils/notificationHelpers.js`:

```jsx
import { createMatchInviteNotification, createMatchUpdateNotification } from '../utils/notificationHelpers';

// Invite a user to a match
await createMatchInviteNotification(userId, senderName, matchData);

// Notify all participants about a match update
await createMatchUpdateNotification(
  matchData,
  'teams_created',
  'Los equipos han sido creados para tu partido'
);
```

## Handling Notification Clicks

In the `NotificationsView` component, you can handle clicks on notifications:

```jsx
const handleNotificationClick = (notification) => {
  // Mark as read
  markAsRead(notification.id);
  
  // Handle different notification types
  switch (notification.type) {
    case 'friend_request':
      // Navigate to friends tab
      break;
    case 'match_invite':
      // Navigate to match
      break;
    default:
      break;
  }
};
```

## Customizing Notification Appearance

You can customize the appearance of notifications by modifying:
- `NotificationBadge.css` - For the badge appearance
- `NotificationsView.css` - For the notifications list appearance

## Real-time Updates

The notification system uses Supabase's real-time subscriptions to update notifications instantly when new ones are created.

## Clearing Notifications

Notifications are automatically marked as read when:
- The user clicks on a notification
- The user navigates to the relevant screen (e.g., Friends tab for friend requests)
- The user clicks "Mark all as read" in the notifications view