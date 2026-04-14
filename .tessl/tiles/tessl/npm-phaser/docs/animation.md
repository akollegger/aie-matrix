# Animation Systems

Phaser provides two powerful animation systems: frame-based animations for sprite sequences and tween animations for smooth property interpolation. These systems work together to create rich, dynamic visual effects.

## Frame-Based Animations

### Animation Manager
The global animation manager handles all sprite animations:

```javascript { .api }
class AnimationScene extends Phaser.Scene {
    preload() {
        // Load spritesheet for animations
        this.load.spritesheet('player', 'assets/player.png', {
            frameWidth: 32,
            frameHeight: 48
        });
        
        // Load texture atlas
        this.load.atlas('characters', 'assets/characters.png', 'assets/characters.json');
    }
    
    create() {
        // Create animations from spritesheet
        this.anims.create({
            key: 'player-walk',
            frames: this.anims.generateFrameNumbers('player', { start: 0, end: 3 }),
            frameRate: 10,
            repeat: -1
        });
        
        this.anims.create({
            key: 'player-idle',
            frames: [{ key: 'player', frame: 4 }],
            frameRate: 20
        });
        
        // Create animations from texture atlas
        this.anims.create({
            key: 'enemy-attack',
            frames: this.anims.generateFrameNames('characters', {
                prefix: 'enemy-attack-',
                start: 1,
                end: 6,
                zeroPad: 3
            }),
            frameRate: 15,
            repeat: 0
        });
        
        // Complex animation configuration
        this.anims.create({
            key: 'explosion',
            frames: this.anims.generateFrameNumbers('explosion', { start: 0, end: 15 }),
            frameRate: 20,
            repeat: 0,
            hideOnComplete: true,
            yoyo: false,
            delay: 0,
            repeatDelay: 0,
            showOnStart: true,
            randomFrame: false,
            duration: 800 // Override frameRate calculation
        });
    }
}
```

### Animation Configuration
Comprehensive animation options:

```javascript { .api }
// Animation creation with all options
scene.anims.create({
    key: 'complex-animation',
    frames: scene.anims.generateFrameNumbers('sprite', { start: 0, end: 7 }),
    
    // Timing
    frameRate: 12,              // Frames per second
    duration: 1000,             // Total duration (overrides frameRate)
    delay: 500,                 // Delay before starting
    
    // Repetition
    repeat: 3,                  // Number of repeats (-1 = infinite)
    repeatDelay: 200,           // Delay between repeats
    yoyo: true,                 // Play forward then backward
    
    // Visibility
    showOnStart: true,          // Show sprite when animation starts
    hideOnComplete: false,      // Hide sprite when animation completes
    
    // Frame selection
    randomFrame: false,         // Start on random frame
    skipMissedFrames: true,     // Skip frames if running slow
    
    // Events
    onStart: (animation, frame, gameObject) => {
        console.log('Animation started');
    },
    onRepeat: (animation, frame, gameObject) => {
        console.log('Animation repeated');
    },
    onUpdate: (animation, frame, gameObject) => {
        console.log('Frame updated to:', frame.index);
    },
    onComplete: (animation, frame, gameObject) => {
        console.log('Animation completed');
    }
});
```

### Frame Generation
Multiple ways to generate frame sequences:

```javascript { .api }
class FrameGenerationScene extends Phaser.Scene {
    create() {
        // Generate numbered frames
        const walkFrames = this.anims.generateFrameNumbers('player', {
            start: 0,
            end: 7,
            first: 1          // First frame to use (optional)
        });
        
        // Generate named frames (for texture atlas)
        const runFrames = this.anims.generateFrameNames('atlas', {
            prefix: 'run-',
            suffix: '.png',
            start: 1,
            end: 8,
            zeroPad: 3        // Pad numbers to 3 digits (001, 002, etc.)
        });
        
        // Custom frame array
        const customFrames = [
            { key: 'atlas', frame: 'idle-1' },
            { key: 'atlas', frame: 'idle-2', duration: 100 },  // Custom frame duration
            { key: 'atlas', frame: 'idle-3' },
            { key: 'player', frame: 0 }  // Mix different textures
        ];
        
        // Create animations
        this.anims.create({
            key: 'walk',
            frames: walkFrames,
            frameRate: 10,
            repeat: -1
        });
        
        this.anims.create({
            key: 'run',
            frames: runFrames,
            frameRate: 15,
            repeat: -1
        });
        
        this.anims.create({
            key: 'custom',
            frames: customFrames,
            frameRate: 8,
            repeat: -1
        });
    }
}
```

### Animation Control
Control animations on GameObjects:

```javascript { .api }
class AnimationControlScene extends Phaser.Scene {
    create() {
        this.player = this.add.sprite(400, 300, 'player');
        
        // Play animation
        this.player.play('walk');
        
        // Play with options
        this.player.play({
            key: 'walk',
            ignoreIfPlaying: false,  // Restart even if already playing
            startFrame: 2,           // Start from specific frame
            timeScale: 1.5           // Play 1.5x speed
        });
        
        // Animation state queries
        console.log('Is playing:', this.player.anims.isPlaying);
        console.log('Current animation:', this.player.anims.currentAnim);
        console.log('Current frame:', this.player.anims.currentFrame);
        console.log('Total frames:', this.player.anims.getTotalFrames());
        console.log('Progress:', this.player.anims.getProgress());
        
        // Animation control
        this.player.anims.pause();
        this.player.anims.resume();
        this.player.anims.stop();
        this.player.anims.restart();
        
        // Play in reverse
        this.player.playReverse('walk');
        
        // Chain animations
        this.player.chain(['walk', 'idle', 'jump']);
        
        // Set time scale (speed multiplier)
        this.player.anims.setTimeScale(2.0);
        
        // Seek to specific progress
        this.player.anims.setProgress(0.5); // 50% through animation
        
        // Set repeat count
        this.player.anims.setRepeat(5);
        
        // Manual frame control
        this.player.setFrame(3);
        this.player.anims.nextFrame();
        this.player.anims.previousFrame();
    }
}
```

### Animation Events
Listen for animation events:

```javascript { .api }
class AnimationEventsScene extends Phaser.Scene {
    create() {
        this.player = this.add.sprite(400, 300, 'player');
        
        // Global animation events (all sprites)
        this.anims.on('animationstart', (anim, frame, gameObject) => {
            console.log('Any animation started:', anim.key);
        });
        
        this.anims.on('animationcomplete', (anim, frame, gameObject) => {
            console.log('Any animation completed:', anim.key);
        });
        
        // Specific animation events
        this.anims.on('animationcomplete-walk', (anim, frame, gameObject) => {
            console.log('Walk animation completed');
            gameObject.play('idle');
        });
        
        // Sprite-specific events
        this.player.on('animationstart', (anim, frame) => {
            console.log('Player animation started:', anim.key);
        });
        
        this.player.on('animationupdate', (anim, frame) => {
            console.log('Player frame:', frame.index);
            
            // Trigger effects on specific frames
            if (frame.index === 2) {
                this.createFootstepEffect();
            }
        });
        
        this.player.on('animationrepeat', (anim, frame) => {
            console.log('Player animation repeated');
        });
        
        this.player.on('animationcomplete', (anim, frame) => {
            console.log('Player animation completed');
            
            // Handle animation completion
            if (anim.key === 'attack') {
                this.player.play('idle');
            } else if (anim.key === 'death') {
                this.gameOver();
            }
        });
    }
}
```

## Tween Animations

### Basic Tweens
Smooth property interpolation:

```javascript { .api }
class TweenBasicsScene extends Phaser.Scene {
    create() {
        this.sprite = this.add.sprite(100, 300, 'player');
        
        // Basic tween
        this.tweens.add({
            targets: this.sprite,
            x: 700,
            duration: 2000,
            ease: 'Power2'
        });
        
        // Multiple properties
        this.tweens.add({
            targets: this.sprite,
            x: 400,
            y: 100,
            scaleX: 2,
            scaleY: 2,
            rotation: Math.PI,
            alpha: 0.5,
            duration: 1500,
            ease: 'Bounce.easeOut'
        });
        
        // Relative values
        this.tweens.add({
            targets: this.sprite,
            x: '+=100',      // Relative to current value
            y: '-=50',
            rotation: '+=0.5',
            duration: 1000
        });
        
        // Array of values (tween through each)
        this.tweens.add({
            targets: this.sprite,
            x: [100, 300, 500, 700],
            y: [100, 200, 300, 100],
            duration: 3000,
            ease: 'Linear'
        });
    }
}
```

### Tween Configuration
Comprehensive tween options:

```javascript { .api }
class TweenConfigScene extends Phaser.Scene {
    create() {
        const sprite = this.add.sprite(400, 300, 'player');
        
        // Full configuration
        this.tweens.add({
            targets: sprite,
            
            // Properties to tween
            x: 600,
            y: 200,
            scaleX: 1.5,
            alpha: 0.8,
            
            // Timing
            duration: 2000,
            delay: 500,              // Delay before starting
            
            // Repetition
            repeat: 2,               // Number of repeats (-1 = infinite)
            repeatDelay: 300,        // Delay between repeats
            yoyo: true,              // Return to start values
            
            // Easing
            ease: 'Power2.easeInOut',
            
            // Hold
            hold: 1000,              // Hold at end values
            
            // Callbacks
            onStart: (tween, targets) => {
                console.log('Tween started');
            },
            onUpdate: (tween, target) => {
                console.log('Tween progress:', tween.progress);
            },
            onRepeat: (tween, target) => {
                console.log('Tween repeated');
            },
            onComplete: (tween, targets) => {
                console.log('Tween completed');
            },
            
            // Callback scope and parameters
            callbackScope: this,
            onCompleteParams: ['param1', 'param2']
        });
    }
}
```

### Easing Functions
Rich collection of easing functions:

```javascript { .api }
// Linear
'Linear'

// Quadratic
'Quad.easeIn'
'Quad.easeOut'  
'Quad.easeInOut'
'Power1' // Same as Quad

// Cubic  
'Cubic.easeIn'
'Cubic.easeOut'
'Cubic.easeInOut'
'Power2' // Same as Cubic

// Quartic
'Quart.easeIn'
'Quart.easeOut'
'Quart.easeInOut'
'Power3' // Same as Quart

// Quintic
'Quint.easeIn'
'Quint.easeOut'
'Quint.easeInOut'  
'Power4' // Same as Quint

// Sine
'Sine.easeIn'
'Sine.easeOut'
'Sine.easeInOut'

// Exponential
'Expo.easeIn'
'Expo.easeOut'
'Expo.easeInOut'

// Circular
'Circ.easeIn'
'Circ.easeOut'
'Circ.easeInOut'

// Back
'Back.easeIn'
'Back.easeOut'
'Back.easeInOut'

// Elastic
'Elastic.easeIn'
'Elastic.easeOut'
'Elastic.easeInOut'

// Bounce
'Bounce.easeIn'
'Bounce.easeOut'
'Bounce.easeInOut'

// Stepped
'Stepped'

// Custom easing function
function customEase(t) {
    return t * t * (3 - 2 * t); // Smoothstep
}
```

### Tween Control
Control tween playback:

```javascript { .api }
class TweenControlScene extends Phaser.Scene {
    create() {
        this.sprite = this.add.sprite(100, 300, 'player');
        
        // Store tween reference
        this.myTween = this.tweens.add({
            targets: this.sprite,
            x: 700,
            duration: 3000,
            paused: true  // Start paused
        });
        
        // Tween control methods
        this.myTween.play();         // Start/resume
        this.myTween.pause();        // Pause
        this.myTween.resume();       // Resume
        this.myTween.stop();         // Stop
        this.myTween.restart();      // Restart from beginning
        
        // Seek to specific progress
        this.myTween.seek(0.5);      // Jump to 50% completion
        
        // Update target values while running
        this.myTween.updateTo('x', 500);  // Change target to 500
        this.myTween.updateTo('y', 200, true);  // Change target, start from current
        
        // Time scale (speed multiplier)
        this.myTween.setTimeScale(2);  // 2x speed
        
        // Tween properties
        console.log('Progress:', this.myTween.progress);
        console.log('Duration:', this.myTween.duration);
        console.log('Is playing:', this.myTween.isPlaying());
        console.log('Is paused:', this.myTween.isPaused());
        console.log('Has started:', this.myTween.hasStarted);
    }
}
```

### Multiple Target Tweens
Tween multiple objects simultaneously:

```javascript { .api }
class MultiTargetScene extends Phaser.Scene {
    create() {
        // Create multiple sprites
        const sprites = [];
        for (let i = 0; i < 5; i++) {
            sprites.push(this.add.sprite(100 + i * 100, 300, 'player'));
        }
        
        // Tween all sprites together
        this.tweens.add({
            targets: sprites,
            y: 100,
            duration: 1000,
            ease: 'Bounce.easeOut'
        });
        
        // Staggered animation
        this.tweens.add({
            targets: sprites,
            x: 600,
            duration: 500,
            delay: this.tweens.stagger(100)  // 100ms delay between each
        });
        
        // Staggered with options
        this.tweens.add({
            targets: sprites,
            scaleX: 2,
            scaleY: 2,
            duration: 800,
            delay: this.tweens.stagger(150, { start: 500, from: 'center' })
        });
    }
}
```

### Tween Chains and Timelines
Sequence multiple animations:

```javascript { .api }
class TweenChainScene extends Phaser.Scene {
    create() {
        this.sprite = this.add.sprite(100, 300, 'player');
        
        // Chain tweens together
        const tween1 = this.tweens.add({
            targets: this.sprite,
            x: 400,
            duration: 1000,
            paused: true
        });
        
        const tween2 = this.tweens.add({
            targets: this.sprite,
            y: 100,
            duration: 1000,
            paused: true
        });
        
        const tween3 = this.tweens.add({
            targets: this.sprite,
            rotation: Math.PI * 2,
            duration: 1000,
            paused: true
        });
        
        // Create chain
        this.tweens.chain({
            tweens: [tween1, tween2, tween3]
        }).play();
        
        // Timeline for complex sequences
        const timeline = this.tweens.timeline({
            targets: this.sprite,
            
            // Timeline tweens
            tweens: [
                {
                    x: 300,
                    duration: 1000
                },
                {
                    y: 200,
                    duration: 500,
                    offset: 800  // Start 800ms into timeline
                },
                {
                    rotation: Math.PI,
                    duration: 1000,
                    offset: '-=500'  // Start 500ms before previous ends
                }
            ],
            
            // Timeline options
            loop: 2,
            loopDelay: 1000,
            onComplete: () => {
                console.log('Timeline complete');
            }
        });
    }
}
```

### Counter Tweens
Animate numbers and custom values:

```javascript { .api }
class CounterTweenScene extends Phaser.Scene {
    create() {
        // Score counter
        this.score = 0;
        this.scoreText = this.add.text(400, 100, 'Score: 0', {
            fontSize: '32px',
            fill: '#ffffff'
        });
        
        // Tween the score value
        this.tweens.addCounter({
            from: 0,
            to: 1000,
            duration: 2000,
            onUpdate: (tween) => {
                this.score = Math.floor(tween.getValue());
                this.scoreText.setText('Score: ' + this.score);
            }
        });
        
        // Health bar animation
        this.healthBarWidth = 200;
        this.healthBar = this.add.rectangle(400, 200, this.healthBarWidth, 20, 0x00ff00);
        
        this.tweens.addCounter({
            from: 100,
            to: 25,
            duration: 3000,
            ease: 'Power2.easeIn',
            onUpdate: (tween) => {
                const health = tween.getValue();
                this.healthBar.width = (health / 100) * this.healthBarWidth;
                
                // Change color based on health
                if (health > 60) {
                    this.healthBar.fillColor = 0x00ff00; // Green
                } else if (health > 30) {
                    this.healthBar.fillColor = 0xffff00; // Yellow
                } else {
                    this.healthBar.fillColor = 0xff0000; // Red
                }
            }
        });
    }
}
```

### Tween Manager
Access and control all tweens:

```javascript { .api }
class TweenManagerScene extends Phaser.Scene {
    create() {
        // Create some tweens
        const sprites = [
            this.add.sprite(100, 100, 'player'),
            this.add.sprite(200, 200, 'player'),
            this.add.sprite(300, 300, 'player')
        ];
        
        sprites.forEach(sprite => {
            this.tweens.add({
                targets: sprite,
                x: 600,
                duration: 2000,
                repeat: -1,
                yoyo: true
            });
        });
        
        // Manager operations
        const allTweens = this.tweens.getAllTweens();
        console.log('Total tweens:', allTweens.length);
        
        // Get tweens of specific object
        const spriteTweens = this.tweens.getTweensOf(sprites[0]);
        
        // Check if object is being tweened
        const isTweening = this.tweens.isTweening(sprites[0]);
        
        // Kill all tweens of object
        this.tweens.killTweensOf(sprites[1]);
        
        // Global tween control
        this.tweens.pauseAll();
        this.tweens.resumeAll();
        this.tweens.killAll();
        
        // Global time scale
        this.tweens.setGlobalTimeScale(0.5); // Half speed
        console.log('Global time scale:', this.tweens.getGlobalTimeScale());
    }
}
```

## Advanced Animation Techniques

### Physics-Based Animations
Combine tweens with physics:

```javascript { .api }
class PhysicsAnimationScene extends Phaser.Scene {
    create() {
        // Enable physics
        this.physics.world.gravity.y = 300;
        
        this.ball = this.physics.add.sprite(100, 100, 'ball');
        this.ball.setBounce(0.8);
        this.ball.setCollideWorldBounds(true);
        
        // Animate physics properties
        this.tweens.add({
            targets: this.ball.body.velocity,
            x: 200,
            y: -400,
            duration: 500
        });
        
        // Animate gravity
        this.tweens.add({
            targets: this.physics.world.gravity,
            y: 800,
            duration: 3000,
            yoyo: true,
            repeat: -1
        });
    }
}
```

### Particle Animation
Animate particle system properties:

```javascript { .api }
class ParticleAnimationScene extends Phaser.Scene {
    create() {
        // Create particle emitter
        this.particles = this.add.particles(400, 300, 'particle', {
            speed: { min: 100, max: 200 },
            lifespan: 1000,
            quantity: 5
        });
        
        // Animate emitter properties
        this.tweens.add({
            targets: this.particles,
            x: 600,
            y: 200,
            duration: 2000,
            yoyo: true,
            repeat: -1
        });
        
        // Animate emission rate
        this.tweens.addCounter({
            from: 5,
            to: 50,
            duration: 3000,
            yoyo: true,
            repeat: -1,
            onUpdate: (tween) => {
                this.particles.setQuantity(tween.getValue());
            }
        });
    }
}
```

### Morphing Animations
Animate shape transformations:

```javascript { .api }
class MorphingScene extends Phaser.Scene {
    create() {
        this.graphics = this.add.graphics();
        
        // Start shape
        this.currentShape = {
            x: 200,
            y: 200,
            radius: 50,
            sides: 3
        };
        
        this.drawShape();
        
        // Morph to different shape
        this.tweens.add({
            targets: this.currentShape,
            radius: 100,
            sides: 8,
            duration: 2000,
            ease: 'Power2.easeInOut',
            onUpdate: () => {
                this.drawShape();
            }
        });
    }
    
    drawShape() {
        this.graphics.clear();
        this.graphics.fillStyle(0x00ff00);
        
        const sides = Math.round(this.currentShape.sides);
        const angleStep = (Math.PI * 2) / sides;
        
        this.graphics.beginPath();
        for (let i = 0; i <= sides; i++) {
            const angle = i * angleStep;
            const x = this.currentShape.x + Math.cos(angle) * this.currentShape.radius;
            const y = this.currentShape.y + Math.sin(angle) * this.currentShape.radius;
            
            if (i === 0) {
                this.graphics.moveTo(x, y);
            } else {
                this.graphics.lineTo(x, y);
            }
        }
        this.graphics.fillPath();
    }
}
```

This comprehensive animation system provides all the tools needed to create engaging, smooth animations that bring games to life with both sprite sequences and property tweening.