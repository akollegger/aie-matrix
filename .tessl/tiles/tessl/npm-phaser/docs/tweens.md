# Tweens & Timeline Animation

Phaser's tweening system provides smooth property animations and complex animation sequences. It offers individual tweens, tween chains, and timeline-based animation management for creating sophisticated visual effects.

## Capabilities

### Tween Manager

Scene-based tween coordination and management for all tweening operations.

```javascript { .api }
// Create basic tween
scene.tweens.add({
    targets: sprite,
    x: 400,
    y: 300,
    duration: 2000,
    ease: 'Power2',
    onComplete: function() {
        console.log('Tween completed');
    }
});

// Multiple property tween
scene.tweens.add({
    targets: [sprite1, sprite2],
    x: '+=100',
    y: '-=50',
    scaleX: 2,
    scaleY: 2,
    rotation: Math.PI,
    alpha: 0.5,
    duration: 1500
});

// Advanced tween configuration
scene.tweens.add({
    targets: sprite,
    props: {
        x: { value: 600, duration: 2000, ease: 'Power1' },
        y: { value: 200, duration: 1000, ease: 'Bounce.easeOut' },
        scaleX: { value: 3, duration: 3000, ease: 'Back.easeInOut' }
    },
    delay: 500,
    repeat: 2,
    yoyo: true,
    paused: false
});
```

### Tween Creation Methods

```javascript { .api }
// Basic add method
scene.tweens.add(config);

// Timeline creation
scene.tweens.timeline(config);

// Counter tween (number animation)
scene.tweens.addCounter({
    from: 0,
    to: 100,
    duration: 2000,
    onUpdate: function(tween) {
        text.setText(Math.floor(tween.getValue()));
    }
});

// Chain multiple tweens
scene.tweens.chain({
    targets: sprite,
    tweens: [
        { x: 200, duration: 1000 },
        { y: 200, duration: 1000 },
        { x: 100, y: 100, duration: 1000 }
    ]
});
```

### Tween Control

```javascript { .api }
// Get tween reference for control
const tween = scene.tweens.add({
    targets: sprite,
    x: 400,
    duration: 2000,
    paused: true
});

// Tween control methods
tween.play();         // Start/resume tween
tween.pause();        // Pause tween
tween.resume();       // Resume paused tween
tween.stop();         // Stop and remove tween
tween.restart();      // Restart from beginning
tween.complete();     // Jump to end
tween.seek(0.5);      // Jump to 50% completion
tween.setTimeScale(2); // Double speed
```

### Timeline System

Complex animation sequences with precise timing control.

```javascript { .api }
// Create timeline
const timeline = scene.tweens.timeline({
    loop: 2,
    loopDelay: 500,
    onComplete: function() {
        console.log('Timeline completed');
    }
});

// Add tweens to timeline
timeline.add({
    targets: sprite1,
    x: 200,
    duration: 1000,
    offset: 0        // Start immediately
});

timeline.add({
    targets: sprite2,
    y: 200,
    duration: 800,
    offset: 500      // Start 500ms after timeline start
});

timeline.add({
    targets: [sprite1, sprite2],
    alpha: 0,
    duration: 500,
    offset: '-=200'  // Start 200ms before previous tween ends
});

timeline.play();
```

### Easing Functions

```javascript { .api }
// Linear easing
'Linear'

// Power easing
'Power0', 'Power1', 'Power2', 'Power3', 'Power4'

// Back easing (overshoot)
'Back.easeIn', 'Back.easeOut', 'Back.easeInOut'

// Bounce easing
'Bounce.easeIn', 'Bounce.easeOut', 'Bounce.easeInOut'

// Elastic easing
'Elastic.easeIn', 'Elastic.easeOut', 'Elastic.easeInOut'

// Expo easing
'Expo.easeIn', 'Expo.easeOut', 'Expo.easeInOut'

// Sine easing
'Sine.easeIn', 'Sine.easeOut', 'Sine.easeInOut'

// Circular easing
'Circ.easeIn', 'Circ.easeOut', 'Circ.easeInOut'

// Cubic easing
'Cubic.easeIn', 'Cubic.easeOut', 'Cubic.easeInOut'

// Quartic easing
'Quart.easeIn', 'Quart.easeOut', 'Quart.easeInOut'

// Quintic easing
'Quint.easeIn', 'Quint.easeOut', 'Quint.easeInOut'

// Custom easing function
function(t) {
    return t * t * t; // Custom cubic curve
}
```

### Tween Configuration Options

```javascript { .api }
const tweenConfig = {
    targets: sprite,           // Target object(s)
    x: 400,                   // End value
    y: '+=200',              // Relative value
    scaleX: { from: 1, to: 2 }, // Start and end values
    
    // Timing
    duration: 2000,           // Animation duration in ms
    delay: 500,              // Start delay in ms
    
    // Repetition
    repeat: 3,               // Number of repeats (-1 for infinite)
    repeatDelay: 200,        // Delay between repeats
    yoyo: true,              // Reverse on repeat
    
    // Easing
    ease: 'Power2',          // Easing function
    
    // Playback
    paused: false,           // Start paused
    
    // Callbacks
    onStart: function(tween, targets) {},
    onUpdate: function(tween, targets) {},
    onYoyo: function(tween, targets) {},
    onRepeat: function(tween, targets) {},
    onComplete: function(tween, targets) {},
    
    // Callback scopes
    onStartScope: this,
    onUpdateScope: this,
    onCompleteScope: this
};
```

### Complex Animation Examples

```javascript { .api }
// Staggered animation
scene.tweens.add({
    targets: spriteArray,
    x: 300,
    duration: 1000,
    delay: scene.tweens.stagger(100) // 100ms delay between each sprite
});

// Property interpolation
scene.tweens.add({
    targets: sprite,
    x: [100, 200, 150, 400], // Tween through multiple values
    duration: 2000
});

// Custom property tweening
scene.tweens.add({
    targets: customObject,
    customValue: 100,
    duration: 2000,
    onUpdate: function() {
        // Use customObject.customValue in your logic
        updateCustomGraphics(customObject.customValue);
    }
});

// Tween with pause and resume
const tween = scene.tweens.add({
    targets: sprite,
    x: 400,
    duration: 4000,
    paused: true
});

// Resume after 2 seconds
scene.time.delayedCall(2000, function() {
    tween.resume();
});
```

## Types

```javascript { .api }
interface TweenConfig {
    targets: any | any[];
    delay?: number;
    duration?: number;
    ease?: string | function;
    repeat?: number;
    repeatDelay?: number;
    yoyo?: boolean;
    paused?: boolean;
    onStart?: function;
    onUpdate?: function;
    onYoyo?: function;
    onRepeat?: function;
    onComplete?: function;
}

interface TimelineConfig {
    loop?: number;
    loopDelay?: number;
    paused?: boolean;
    onStart?: function;
    onUpdate?: function;
    onLoop?: function;
    onYoyo?: function;
    onComplete?: function;
}

class Tween {
    play(): this;
    pause(): this;
    resume(): this;
    stop(): this;
    restart(): this;
    complete(): this;
    seek(progress: number): this;
    setTimeScale(scale: number): this;
    getProgress(): number;
    getTotalProgress(): number;
    isPlaying(): boolean;
    isPaused(): boolean;
}

class Timeline {
    add(config: TweenConfig): this;
    play(): this;
    pause(): this;
    resume(): this;
    stop(): this;
    destroy(): void;
}
```