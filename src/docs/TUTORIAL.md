# Interactive Tutorial Documentation

This document explains how to use and customize the interactive tutorial (onboarding tour) in the Team Balancer app.

## Overview

The tutorial system provides a step-by-step guided tour of the app's main features using react-joyride. It shows a welcome modal for first-time users and can be replayed from the profile settings.

## Components

### TutorialContext

The `TutorialContext` provides global access to tutorial state and functions:

```jsx
import { useTutorial } from '../context/TutorialContext';

const MyComponent = () => {
  const { 
    showTutorial,       // Whether the tutorial is currently showing
    showWelcomeModal,   // Whether the welcome modal is showing
    tutorialStep,       // Current step in the tutorial
    run,                // Whether the tutorial is running
    startTutorial,      // Function to start the tutorial
    skipTutorial,       // Function to skip the tutorial
    completeTutorial,   // Function to mark the tutorial as completed
    replayTutorial      // Function to replay the tutorial
  } = useTutorial();
  
  // Your component code
};
```

### WelcomeModal

The `WelcomeModal` component displays a welcome message for first-time users with options to start or skip the tutorial.

### Tutorial

The `Tutorial` component uses react-joyride to create the step-by-step guided tour.

## Customizing the Tutorial Steps

To customize the tutorial steps, edit the `steps` array in the `Tutorial.js` file:

```jsx
const steps = [
  {
    target: '.selector-for-element',  // CSS selector for the element to highlight
    content: 'Your explanation text',  // Text to display in the tooltip
    placement: 'top',                 // Tooltip placement (top, bottom, left, right, etc.)
    disableBeacon: true,              // Whether to disable the beacon
    spotlightClicks: true,            // Whether to allow clicks through the spotlight
  },
  // Add more steps as needed
];
```

## Adding Media to Tutorial Steps

To add images or GIFs to tutorial steps:

```jsx
const steps = [
  {
    target: '.selector-for-element',
    content: (
      <div>
        <p>Your explanation text</p>
        <img 
          src="/path/to/image.gif" 
          alt="Feature demonstration" 
          style={{ width: '100%', borderRadius: '8px', marginTop: '10px' }}
        />
      </div>
    ),
    placement: 'bottom',
  },
  // More steps...
];
```

## Triggering the Tutorial Programmatically

You can trigger the tutorial from any component:

```jsx
import { useTutorial } from '../context/TutorialContext';

const MyComponent = () => {
  const { replayTutorial } = useTutorial();
  
  return (
    <button onClick={replayTutorial}>
      Start Tutorial
    </button>
  );
};
```

## Customizing the Welcome Modal

To customize the welcome modal, edit the `WelcomeModal.js` and `WelcomeModal.css` files.

## Localization

To change the language of the tutorial, update the `locale` prop in the `Tutorial.js` file:

```jsx
<Joyride
  steps={steps}
  // Other props...
  locale={{
    back: 'Anterior',
    close: 'Cerrar',
    last: 'Finalizar',
    next: 'Siguiente',
    skip: 'Omitir',
  }}
/>
```

## Styling

To customize the appearance of the tutorial tooltips, edit the `Tutorial.css` file or update the `styles` prop in the `Tutorial.js` file:

```jsx
const joyrideStyles = {
  options: {
    primaryColor: '#8178e5',
    backgroundColor: '#ffffff',
    textColor: '#333333',
    arrowColor: '#ffffff',
  },
  // Other style overrides...
};
```

## Troubleshooting

### Elements Not Being Highlighted Correctly

- Make sure the CSS selectors in the `target` property are correct
- Check if the elements are in the DOM when the tutorial runs
- Try using more specific selectors if needed

### Tutorial Not Showing for First-Time Users

- Check if `localStorage.getItem('hasSeenTutorial')` is working correctly
- Clear localStorage to test the first-time user experience

### Tooltip Positioning Issues

- Try different `placement` values
- Check if the element is visible in the viewport
- Consider using `scrollOffset` or `scrollDuration` props

## Best Practices

1. Keep tutorial steps concise and focused
2. Use clear and simple language
3. Allow users to skip the tutorial at any time
4. Test the tutorial on different screen sizes
5. Consider adding visual aids (images, GIFs) for complex features
6. Make sure the tutorial doesn't block important UI elements
7. Update the tutorial when adding new features