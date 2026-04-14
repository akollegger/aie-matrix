# Events System

Phaser's event system is built on EventEmitter3, providing powerful event-driven programming capabilities throughout the framework. Events enable decoupled communication between game objects, scenes, and systems.

## Capabilities

### Core Event Methods

All Phaser objects that emit events (Scene, GameObject, etc.) provide these core event methods:

```javascript { .api }
// Add event listener
scene.events.on('eventName', function(data) {
    console.log('Event received:', data);
});

// Add one-time event listener
scene.events.once('eventName', function(data) {
    console.log('This will only fire once:', data);
});

// Remove event listener
scene.events.off('eventName', callbackFunction);

// Remove all listeners for an event
scene.events.off('eventName');

// Remove all listeners for all events
scene.events.removeAllListeners();

// Emit event
scene.events.emit('eventName', data);

// Check if event has listeners
const hasListeners = scene.events.listenerCount('eventName') > 0;

// Get all event names
const eventNames = scene.events.eventNames();
```

### Scene Events

Scene lifecycle and management events:

```javascript { .api }
// Scene lifecycle events
scene.events.on('preupdate', function(time, delta) {
    // Called before scene update
});

scene.events.on('update', function(time, delta) {
    // Called during scene update
});

scene.events.on('postupdate', function(time, delta) {
    // Called after scene update
});

scene.events.on('render', function(renderer) {
    // Called during rendering
});

scene.events.on('pause', function() {
    // Scene was paused
});

scene.events.on('resume', function() {
    // Scene was resumed
});

scene.events.on('sleep', function() {
    // Scene went to sleep
});

scene.events.on('wake', function() {
    // Scene woke up
});

scene.events.on('shutdown', function() {
    // Scene is shutting down
});

scene.events.on('destroy', function() {
    // Scene is being destroyed
});

// Scene transition events
scene.events.on('transitionstart', function(fromScene, duration) {
    console.log(`Transitioning from ${fromScene.scene.key} over ${duration}ms`);
});

scene.events.on('transitioncomplete', function(fromScene) {
    console.log(`Transition completed from ${fromScene.scene.key}`);
});
```

### GameObject Events

Game objects emit various events for interaction and lifecycle management:

```javascript { .api }
// Make GameObject interactive and listen for input events
sprite.setInteractive();

sprite.on('pointerdown', function(pointer, localX, localY, event) {
    console.log('Sprite clicked at:', localX, localY);
});

sprite.on('pointerup', function(pointer, localX, localY, event) {
    console.log('Sprite released');
});

sprite.on('pointermove', function(pointer, localX, localY, event) {
    console.log('Pointer moved over sprite');
});

sprite.on('pointerover', function(pointer, localX, localY, event) {
    console.log('Pointer entered sprite');
    sprite.setTint(0xffff00); // Yellow tint on hover
});

sprite.on('pointerout', function(pointer, event) {
    console.log('Pointer left sprite');
    sprite.clearTint(); // Remove tint
});

// Drag events
sprite.on('dragstart', function(pointer, dragX, dragY) {
    console.log('Started dragging sprite');
});

sprite.on('drag', function(pointer, dragX, dragY) {
    sprite.x = dragX;
    sprite.y = dragY;
});

sprite.on('dragend', function(pointer, dragX, dragY, dropped) {
    console.log('Stopped dragging sprite');
});

// GameObject lifecycle events
sprite.on('destroy', function() {
    console.log('Sprite is being destroyed');
});
```

### Input Events

Global input events available through the scene's input manager:

```javascript { .api }
// Global pointer events
scene.input.on('pointerdown', function(pointer) {
    console.log('Pointer down at:', pointer.x, pointer.y);
});

scene.input.on('pointerup', function(pointer) {
    console.log('Pointer up at:', pointer.x, pointer.y);
});

scene.input.on('pointermove', function(pointer) {
    console.log('Pointer moved to:', pointer.x, pointer.y);
});

// Keyboard events
scene.input.keyboard.on('keydown', function(event) {
    console.log('Key pressed:', event.code);
});

scene.input.keyboard.on('keyup', function(event) {
    console.log('Key released:', event.code);
});

// Specific key events
const spaceKey = scene.input.keyboard.addKey('SPACE');
spaceKey.on('down', function() {
    console.log('Space key pressed');
});

spaceKey.on('up', function() {
    console.log('Space key released');
});

// Gamepad events
scene.input.gamepad.on('connected', function(pad) {
    console.log('Gamepad connected:', pad.id);
});

scene.input.gamepad.on('disconnected', function(pad) {
    console.log('Gamepad disconnected:', pad.id);
});
```

### Animation Events

Animation and tween events for coordinating visual effects:

```javascript { .api }
// Sprite animation events
sprite.on('animationstart', function(animation, frame) {
    console.log('Animation started:', animation.key);
});

sprite.on('animationupdate', function(animation, frame) {
    console.log('Animation frame changed:', frame.index);
});

sprite.on('animationcomplete', function(animation, frame) {
    console.log('Animation completed:', animation.key);
});

sprite.on('animationrepeat', function(animation, frame) {
    console.log('Animation repeated:', animation.key);
});

// Tween events
const tween = scene.tweens.add({
    targets: sprite,
    x: 400,
    duration: 2000,
    onStart: function() {
        console.log('Tween started');
    },
    onUpdate: function() {
        console.log('Tween updated');
    },
    onComplete: function() {
        console.log('Tween completed');
    }
});

// Listen to tween events externally
tween.on('start', function() {
    console.log('Tween started (external listener)');
});

tween.on('complete', function() {
    console.log('Tween completed (external listener)');
});
```

### Physics Events

Physics system events for collision detection and interaction:

```javascript { .api }
// Arcade Physics collision events
const player = scene.physics.add.sprite(100, 100, 'player');
const enemy = scene.physics.add.sprite(200, 100, 'enemy');

// Collision detection with callback
scene.physics.add.collider(player, enemy, function(player, enemy) {
    console.log('Player collided with enemy');
    player.setTint(0xff0000); // Red tint on collision
});

// Overlap detection (no physics separation)
scene.physics.add.overlap(player, enemy, function(player, enemy) {
    console.log('Player overlapped with enemy');
});

// Matter.js physics events
scene.matter.world.on('collisionstart', function(event) {
    const pairs = event.pairs;
    pairs.forEach(function(pair) {
        const bodyA = pair.bodyA;
        const bodyB = pair.bodyB;
        console.log('Collision started between:', bodyA.label, bodyB.label);
    });
});

scene.matter.world.on('collisionend', function(event) {
    console.log('Collision ended');
});
```

### Audio Events

Audio system events for sound management:

```javascript { .api }
// Sound events
const music = scene.sound.add('backgroundMusic');

music.on('play', function() {
    console.log('Music started playing');
});

music.on('pause', function() {
    console.log('Music paused');
});

music.on('resume', function() {
    console.log('Music resumed');
});

music.on('stop', function() {
    console.log('Music stopped');
});

music.on('complete', function() {
    console.log('Music finished playing');
});

music.on('looped', function() {
    console.log('Music looped');
});

// Global sound manager events
scene.sound.on('mute', function() {
    console.log('All sounds muted');
});

scene.sound.on('unmute', function() {
    console.log('All sounds unmuted');
});

scene.sound.on('volume', function(volume) {
    console.log('Master volume changed to:', volume);
});
```

### Custom Events

Create and manage custom events for game-specific communication:

```javascript { .api }
// Create custom event system
class GameEventManager extends Phaser.Events.EventEmitter {
    constructor() {
        super();
    }
    
    playerScored(points) {
        this.emit('player-scored', points);
    }
    
    enemyDefeated(enemyType, points) {
        this.emit('enemy-defeated', enemyType, points);
    }
    
    levelCompleted(levelNumber, time) {
        this.emit('level-completed', levelNumber, time);
    }
}

// Use custom events
const gameEvents = new GameEventManager();

// Listen for custom events
gameEvents.on('player-scored', function(points) {
    console.log('Player scored:', points);
    updateScoreDisplay(points);
});

gameEvents.on('enemy-defeated', function(enemyType, points) {
    console.log(`Defeated ${enemyType} for ${points} points`);
    addFloatingText(`+${points}`, enemy.x, enemy.y);
});

gameEvents.on('level-completed', function(levelNumber, time) {
    console.log(`Level ${levelNumber} completed in ${time}ms`);
    showCompletionBonus(levelNumber, time);
});

// Emit custom events
gameEvents.playerScored(100);
gameEvents.enemyDefeated('goblin', 50);
gameEvents.levelCompleted(1, 45000);
```

### Event Management Patterns

```javascript { .api }
// Event cleanup on scene shutdown
scene.events.on('shutdown', function() {
    // Clean up global event listeners
    gameEvents.removeAllListeners();
    
    // Clean up input listeners
    scene.input.keyboard.removeAllListeners();
    
    // Clean up physics events
    scene.physics.world.removeAllListeners();
});

// Conditional event handling
let gameState = 'playing';

scene.input.on('pointerdown', function(pointer) {
    if (gameState === 'playing') {
        handleGameplayClick(pointer);
    } else if (gameState === 'paused') {
        handlePausedClick(pointer);
    }
});

// Event delegation pattern
scene.events.on('custom-action', function(actionType, data) {
    switch(actionType) {
        case 'heal-player':
            player.heal(data.amount);
            break;
        case 'damage-enemy':
            data.enemy.takeDamage(data.amount);
            break;
        case 'collect-item':
            inventory.addItem(data.item);
            break;
    }
});

// Event with context binding
class Player {
    constructor(scene, x, y) {
        this.scene = scene;
        this.sprite = scene.add.sprite(x, y, 'player');
        this.health = 100;
        
        // Bind event handlers to maintain context
        scene.events.on('enemy-attack', this.takeDamage, this);
        scene.events.on('heal-pickup', this.heal, this);
    }
    
    takeDamage(amount) {
        this.health -= amount;
        if (this.health <= 0) {
            this.die();
        }
    }
    
    heal(amount) {
        this.health = Math.min(100, this.health + amount);
    }
    
    die() {
        this.scene.events.emit('player-died');
        this.sprite.destroy();
    }
}
```

## Types

```javascript { .api }
class EventEmitter {
    // Event registration
    on(event: string, fn: function, context?: any): this;
    once(event: string, fn: function, context?: any): this;
    off(event?: string, fn?: function, context?: any): this;
    
    // Event emission
    emit(event: string, ...args: any[]): boolean;
    
    // Event introspection
    eventNames(): string[];
    listenerCount(event: string): number;
    listeners(event: string): function[];
    
    // Cleanup
    removeAllListeners(event?: string): this;
    destroy(): void;
}

// Common event callback signatures
type PointerEventCallback = (pointer: Phaser.Input.Pointer, localX?: number, localY?: number, event?: Phaser.Types.Input.EventData) => void;
type KeyboardEventCallback = (event: KeyboardEvent) => void;
type AnimationEventCallback = (animation: Phaser.Animations.Animation, frame: Phaser.Animations.AnimationFrame) => void;
type TweenEventCallback = (tween: Phaser.Tweens.Tween, targets: any[]) => void;
type SceneEventCallback = (time?: number, delta?: number) => void;
```