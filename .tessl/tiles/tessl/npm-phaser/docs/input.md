# Input Handling

Phaser provides comprehensive input handling for keyboard, mouse, touch, and gamepad input across desktop and mobile platforms. The input system supports both polling and event-driven approaches for maximum flexibility.

## Input Manager

### Scene Input Plugin
Each scene has its own input manager accessible via `this.input`:

```javascript { .api }
class InputScene extends Phaser.Scene {
    create() {
        const input = this.input;
        
        // Input properties
        console.log('Active pointer count:', input.activePointer);
        console.log('Mouse enabled:', input.mouse.enabled);
        console.log('Touch enabled:', input.touch.enabled);
        console.log('Gamepad enabled:', input.gamepad.enabled);
        
        // Global input events
        input.on('pointerdown', this.handlePointerDown, this);
        input.on('pointermove', this.handlePointerMove, this);
        input.on('pointerup', this.handlePointerUp, this);
        input.on('gameout', () => console.log('Pointer left game area'));
        input.on('gameover', () => console.log('Pointer entered game area'));
    }
    
    handlePointerDown(pointer) {
        console.log('Pointer down at:', pointer.x, pointer.y);
        console.log('Left button:', pointer.leftButtonDown());
        console.log('Right button:', pointer.rightButtonDown());
        console.log('Middle button:', pointer.middleButtonDown());
    }
}
```

### Pointer Objects
Pointers represent mouse cursors or touch points:

```javascript { .api }
class PointerScene extends Phaser.Scene {
    create() {
        this.input.on('pointerdown', (pointer) => {
            // Pointer properties
            console.log('Position:', pointer.x, pointer.y);
            console.log('World position:', pointer.worldX, pointer.worldY);
            console.log('Previous position:', pointer.prevPosition.x, pointer.prevPosition.y);
            console.log('Velocity:', pointer.velocity.x, pointer.velocity.y);
            console.log('Distance:', pointer.distance);
            console.log('Duration:', pointer.getDuration());
            console.log('Angle:', pointer.angle);
            
            // Pointer identification
            console.log('Pointer ID:', pointer.id);
            console.log('Is primary pointer:', pointer.primaryDown);
            console.log('Active buttons:', pointer.buttons);
            
            // Touch-specific properties
            console.log('Touch ID:', pointer.identifier);
            console.log('Touch pressure:', pointer.pressure);
            console.log('Touch size:', pointer.touchSizeX, pointer.touchSizeY);
        });
        
        // Multi-touch support
        this.input.on('pointerdown', (pointer) => {
            if (pointer.id === 0) {
                console.log('First finger down');
            } else if (pointer.id === 1) {
                console.log('Second finger down - pinch gesture possible');
            }
        });
    }
}
```

## Keyboard Input

### Cursor Keys
Quick access to arrow keys:

```javascript { .api }
class KeyboardScene extends Phaser.Scene {
    create() {
        // Create cursor keys object
        this.cursors = this.input.keyboard.createCursorKeys();
    }
    
    update() {
        // Polling approach
        if (this.cursors.left.isDown) {
            this.player.x -= 200 * this.game.loop.delta / 1000;
        }
        if (this.cursors.right.isDown) {
            this.player.x += 200 * this.game.loop.delta / 1000;
        }
        if (this.cursors.up.isDown) {
            this.player.y -= 200 * this.game.loop.delta / 1000;
        }
        if (this.cursors.down.isDown) {
            this.player.y += 200 * this.game.loop.delta / 1000;
        }
        
        // Check for just pressed/released
        if (Phaser.Input.Keyboard.JustDown(this.cursors.space)) {
            this.playerJump();
        }
        if (Phaser.Input.Keyboard.JustUp(this.cursors.space)) {
            this.playerLand();
        }
    }
}
```

### Individual Keys
Create and manage individual key objects:

```javascript { .api }
class IndividualKeysScene extends Phaser.Scene {
    create() {
        // Create individual keys
        this.wasdKeys = this.input.keyboard.addKeys('W,S,A,D');
        this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
        this.escKey = this.input.keyboard.addKey('ESC');
        this.enterKey = this.input.keyboard.addKey(13); // Key code
        
        // Key events
        this.spaceKey.on('down', () => {
            console.log('Space pressed');
        });
        
        this.spaceKey.on('up', () => {
            console.log('Space released');
        });
        
        // Global keyboard events
        this.input.keyboard.on('keydown', (event) => {
            console.log('Key pressed:', event.code);
        });
        
        this.input.keyboard.on('keyup-ESC', () => {
            this.scene.pause();
        });
    }
    
    update() {
        // WASD movement
        const speed = 200;
        const delta = this.game.loop.delta / 1000;
        
        if (this.wasdKeys.A.isDown) {
            this.player.x -= speed * delta;
        }
        if (this.wasdKeys.D.isDown) {
            this.player.x += speed * delta;
        }
        if (this.wasdKeys.W.isDown) {
            this.player.y -= speed * delta;
        }
        if (this.wasdKeys.S.isDown) {
            this.player.y += speed * delta;
        }
    }
}
```

### Key Combinations
Handle complex key combinations:

```javascript { .api }
class KeyCombinationsScene extends Phaser.Scene {
    create() {
        // Create key combinations
        this.keys = this.input.keyboard.addKeys({
            'up': Phaser.Input.Keyboard.KeyCodes.W,
            'down': Phaser.Input.Keyboard.KeyCodes.S,
            'left': Phaser.Input.Keyboard.KeyCodes.A,
            'right': Phaser.Input.Keyboard.KeyCodes.D,
            'shift': Phaser.Input.Keyboard.KeyCodes.SHIFT,
            'ctrl': Phaser.Input.Keyboard.KeyCodes.CTRL,
            'alt': Phaser.Input.Keyboard.KeyCodes.ALT
        });
        
        // Key combo events
        this.input.keyboard.createCombo([
            Phaser.Input.Keyboard.KeyCodes.CTRL,
            Phaser.Input.Keyboard.KeyCodes.S
        ], {
            resetOnMatch: true,
            maxKeyDelay: 0,
            resetOnWrongKey: true,
            deleteOnMatch: false
        });
        
        this.input.keyboard.on('keycombomatch', (combo) => {
            console.log('Key combo matched!');
            this.saveGame();
        });
    }
    
    update() {
        const speed = this.keys.shift.isDown ? 400 : 200; // Run when shift held
        const delta = this.game.loop.delta / 1000;
        
        // Modifier key combinations
        if (this.keys.ctrl.isDown && this.keys.up.isDown) {
            this.player.jump();
        } else if (this.keys.up.isDown) {
            this.player.y -= speed * delta;
        }
        
        if (this.keys.alt.isDown && this.keys.left.isDown) {
            this.player.strafe(-1);
        } else if (this.keys.left.isDown) {
            this.player.x -= speed * delta;
        }
    }
}
```

### Key Codes
Common key code constants:

```javascript { .api }
const KeyCodes = Phaser.Input.Keyboard.KeyCodes;

// Letter keys
KeyCodes.A // 65
KeyCodes.B // 66
// ... through Z

// Number keys  
KeyCodes.ZERO    // 48
KeyCodes.ONE     // 49
// ... through NINE (57)

// Function keys
KeyCodes.F1      // 112
KeyCodes.F2      // 113
// ... through F12 (123)

// Special keys
KeyCodes.SPACE   // 32
KeyCodes.ENTER   // 13
KeyCodes.ESC     // 27
KeyCodes.TAB     // 9
KeyCodes.SHIFT   // 16
KeyCodes.CTRL    // 17
KeyCodes.ALT     // 18

// Arrow keys
KeyCodes.LEFT    // 37
KeyCodes.UP      // 38  
KeyCodes.RIGHT   // 39
KeyCodes.DOWN    // 40
```

## Mouse and Touch Input

### Basic Mouse/Touch Events
Handle mouse and touch uniformly through pointers:

```javascript { .api }
class MouseTouchScene extends Phaser.Scene {
    create() {
        // Basic pointer events
        this.input.on('pointerdown', (pointer, gameObject) => {
            console.log('Pointer down at:', pointer.x, pointer.y);
            this.createClickEffect(pointer.x, pointer.y);
        });
        
        this.input.on('pointermove', (pointer) => {
            if (pointer.isDown) {
                console.log('Dragging at:', pointer.x, pointer.y);
                this.drawTrail(pointer.x, pointer.y);
            }
        });
        
        this.input.on('pointerup', (pointer) => {
            console.log('Pointer released after:', pointer.getDuration(), 'ms');
        });
        
        // Mouse-specific events
        this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY, deltaZ) => {
            console.log('Mouse wheel:', deltaY);
            this.cameras.main.zoom += deltaY > 0 ? -0.1 : 0.1;
        });
        
        // Right-click context menu
        this.input.on('pointerdown', (pointer) => {
            if (pointer.rightButtonDown()) {
                this.showContextMenu(pointer.x, pointer.y);
            }
        });
    }
    
    createClickEffect(x, y) {
        const effect = this.add.circle(x, y, 20, 0xffffff, 0.5);
        this.tweens.add({
            targets: effect,
            scaleX: 2,
            scaleY: 2,
            alpha: 0,
            duration: 300,
            onComplete: () => effect.destroy()
        });
    }
}
```

### Interactive Objects
Make game objects respond to input:

```javascript { .api }
class InteractiveScene extends Phaser.Scene {
    create() {
        // Basic interactive object
        const button = this.add.rectangle(400, 300, 200, 100, 0x00ff00);
        button.setInteractive();
        
        button.on('pointerdown', () => {
            console.log('Button clicked!');
        });
        
        button.on('pointerover', () => {
            button.setFillStyle(0x00aa00);
        });
        
        button.on('pointerout', () => {
            button.setFillStyle(0x00ff00);
        });
        
        // Custom hit areas
        const sprite = this.add.sprite(200, 200, 'player');
        sprite.setInteractive(new Phaser.Geom.Circle(25, 25, 25), Phaser.Geom.Circle.Contains);
        
        // Rectangle hit area
        const image = this.add.image(600, 200, 'logo');
        image.setInteractive(new Phaser.Geom.Rectangle(0, 0, 100, 50), Phaser.Geom.Rectangle.Contains);
        
        // Pixel-perfect hit detection
        const pixelSprite = this.add.sprite(400, 500, 'character');
        pixelSprite.setInteractive({
            pixelPerfect: true,
            alphaTolerance: 1
        });
    }
}
```

### Drag and Drop
Implement drag and drop functionality:

```javascript { .api }
class DragDropScene extends Phaser.Scene {
    create() {
        // Create draggable objects
        const box1 = this.add.rectangle(200, 200, 100, 100, 0xff0000);
        const box2 = this.add.rectangle(400, 200, 100, 100, 0x00ff00);
        const box3 = this.add.rectangle(600, 200, 100, 100, 0x0000ff);
        
        // Make objects draggable
        box1.setInteractive({ draggable: true });
        box2.setInteractive({ draggable: true });
        box3.setInteractive({ draggable: true });
        
        // Drag events
        this.input.on('dragstart', (pointer, gameObject) => {
            console.log('Drag started:', gameObject);
            gameObject.setTint(0x888888);
        });
        
        this.input.on('drag', (pointer, gameObject, dragX, dragY) => {
            gameObject.x = dragX;
            gameObject.y = dragY;
        });
        
        this.input.on('dragend', (pointer, gameObject) => {
            console.log('Drag ended:', gameObject);
            gameObject.clearTint();
        });
        
        // Drop zones
        const dropZone = this.add.zone(400, 500, 200, 100);
        dropZone.setRectangleDropZone(200, 100);
        
        // Visual feedback for drop zone
        const dropZoneGraphic = this.add.graphics();
        dropZoneGraphic.lineStyle(2, 0xffffff);
        dropZoneGraphic.strokeRect(300, 450, 200, 100);
        
        // Drop events
        this.input.on('drop', (pointer, gameObject, dropZone) => {
            console.log('Object dropped in zone!');
            gameObject.x = dropZone.x;
            gameObject.y = dropZone.y;
        });
        
        this.input.on('dragenter', (pointer, gameObject, dropZone) => {
            dropZoneGraphic.clear();
            dropZoneGraphic.lineStyle(2, 0x00ff00);
            dropZoneGraphic.strokeRect(300, 450, 200, 100);
        });
        
        this.input.on('dragleave', (pointer, gameObject, dropZone) => {
            dropZoneGraphic.clear();
            dropZoneGraphic.lineStyle(2, 0xffffff);
            dropZoneGraphic.strokeRect(300, 450, 200, 100);
        });
    }
}
```

## Gamepad Input

### Gamepad Setup
Support for multiple gamepads:

```javascript { .api }
class GamepadScene extends Phaser.Scene {
    create() {
        // Enable gamepad input
        this.input.gamepad.start();
        
        // Listen for gamepad connection
        this.input.gamepad.on('connected', (pad) => {
            console.log('Gamepad connected:', pad.index, pad.id);
            this.setupGamepad(pad);
        });
        
        this.input.gamepad.on('disconnected', (pad) => {
            console.log('Gamepad disconnected:', pad.index);
        });
        
        // Get existing gamepads
        if (this.input.gamepad.total > 0) {
            this.gamepad = this.input.gamepad.pad1; // First gamepad
            this.setupGamepad(this.gamepad);
        }
    }
    
    setupGamepad(pad) {
        // Button events
        pad.on('down', (index, value, button) => {
            console.log('Button pressed:', index, button.id);
        });
        
        pad.on('up', (index, value, button) => {
            console.log('Button released:', index);
        });
        
        // Specific button events
        if (pad.A) {
            pad.A.on('down', () => {
                this.playerJump();
            });
        }
        
        if (pad.B) {
            pad.B.on('down', () => {
                this.playerAttack();
            });
        }
    }
    
    update() {
        if (this.gamepad) {
            // Left stick movement
            const leftStick = this.gamepad.leftStick;
            if (leftStick.length > 0.1) { // Deadzone
                this.player.x += leftStick.x * 200 * (this.game.loop.delta / 1000);
                this.player.y += leftStick.y * 200 * (this.game.loop.delta / 1000);
            }
            
            // Right stick camera
            const rightStick = this.gamepad.rightStick;
            if (rightStick.length > 0.1) {
                this.cameras.main.scrollX += rightStick.x * 100 * (this.game.loop.delta / 1000);
                this.cameras.main.scrollY += rightStick.y * 100 * (this.game.loop.delta / 1000);
            }
            
            // D-pad
            if (this.gamepad.left) {
                this.selectMenuItem(-1);
            }
            if (this.gamepad.right) {
                this.selectMenuItem(1);
            }
            
            // Triggers
            if (this.gamepad.L2 > 0.5) {
                this.aimWeapon();
            }
            if (this.gamepad.R2 > 0.5) {
                this.fireWeapon(this.gamepad.R2); // Pressure sensitive
            }
        }
    }
}
```

### Gamepad Button Mapping
Access gamepad buttons by name or index:

```javascript { .api }
class GamepadMappingScene extends Phaser.Scene {
    update() {
        const pad = this.input.gamepad.pad1;
        
        if (pad) {
            // Face buttons (Xbox layout)
            if (pad.A && pad.A.pressed) { console.log('A pressed'); }
            if (pad.B && pad.B.pressed) { console.log('B pressed'); }
            if (pad.X && pad.X.pressed) { console.log('X pressed'); }
            if (pad.Y && pad.Y.pressed) { console.log('Y pressed'); }
            
            // Shoulder buttons
            if (pad.L1 && pad.L1.pressed) { console.log('Left bumper'); }
            if (pad.R1 && pad.R1.pressed) { console.log('Right bumper'); }
            
            // Triggers (analog values)
            if (pad.L2 > 0) { console.log('Left trigger:', pad.L2); }
            if (pad.R2 > 0) { console.log('Right trigger:', pad.R2); }
            
            // D-pad
            if (pad.up) { console.log('D-pad up'); }
            if (pad.down) { console.log('D-pad down'); }
            if (pad.left) { console.log('D-pad left'); }
            if (pad.right) { console.log('D-pad right'); }
            
            // Stick buttons
            if (pad.L3 && pad.L3.pressed) { console.log('Left stick pressed'); }
            if (pad.R3 && pad.R3.pressed) { console.log('Right stick pressed'); }
            
            // System buttons
            if (pad.select && pad.select.pressed) { console.log('Select/Back'); }
            if (pad.start && pad.start.pressed) { console.log('Start/Menu'); }
        }
    }
}
```

## Advanced Input Techniques

### Input Sequences
Detect complex input patterns:

```javascript { .api }
class InputSequenceScene extends Phaser.Scene {
    create() {
        // Fighting game combo system
        this.comboSequence = [];
        this.comboTimer = 0;
        this.maxComboDelay = 1000; // 1 second between inputs
        
        // Define combos
        this.combos = {
            'hadoken': ['down', 'down-forward', 'forward', 'punch'],
            'shoryuken': ['forward', 'down', 'down-forward', 'punch'],
            'spin-kick': ['back', 'back', 'forward', 'kick']
        };
        
        // Input detection
        this.input.keyboard.on('keydown-S', () => this.addToCombo('down'));
        this.input.keyboard.on('keydown-W', () => this.addToCombo('up'));
        this.input.keyboard.on('keydown-A', () => this.addToCombo('back'));
        this.input.keyboard.on('keydown-D', () => this.addToCombo('forward'));
        this.input.keyboard.on('keydown-J', () => this.addToCombo('punch'));
        this.input.keyboard.on('keydown-K', () => this.addToCombo('kick'));
    }
    
    addToCombo(input) {
        this.comboSequence.push(input);
        this.comboTimer = this.time.now;
        
        // Check for combo matches
        this.checkCombos();
        
        // Clear old inputs
        if (this.comboSequence.length > 10) {
            this.comboSequence.shift();
        }
    }
    
    checkCombos() {
        const sequence = this.comboSequence.join('-');
        
        for (let [comboName, comboInputs] of Object.entries(this.combos)) {
            const comboString = comboInputs.join('-');
            if (sequence.includes(comboString)) {
                this.executeCombo(comboName);
                this.comboSequence = [];
                break;
            }
        }
    }
    
    update(time) {
        // Clear combo if too much time has passed
        if (time - this.comboTimer > this.maxComboDelay) {
            this.comboSequence = [];
        }
    }
}
```

### Gesture Recognition
Basic gesture detection for touch input:

```javascript { .api }
class GestureScene extends Phaser.Scene {
    create() {
        this.gesturePoints = [];
        this.isRecording = false;
        
        this.input.on('pointerdown', (pointer) => {
            this.isRecording = true;
            this.gesturePoints = [{ x: pointer.x, y: pointer.y, time: this.time.now }];
        });
        
        this.input.on('pointermove', (pointer) => {
            if (this.isRecording) {
                this.gesturePoints.push({ 
                    x: pointer.x, 
                    y: pointer.y, 
                    time: this.time.now 
                });
            }
        });
        
        this.input.on('pointerup', () => {
            this.isRecording = false;
            this.recognizeGesture();
        });
    }
    
    recognizeGesture() {
        if (this.gesturePoints.length < 3) return;
        
        const startPoint = this.gesturePoints[0];
        const endPoint = this.gesturePoints[this.gesturePoints.length - 1];
        
        const deltaX = endPoint.x - startPoint.x;
        const deltaY = endPoint.y - startPoint.y;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        if (distance > 100) { // Minimum swipe distance
            const angle = Math.atan2(deltaY, deltaX);
            const degrees = Phaser.Math.RadToDeg(angle);
            
            if (degrees > -45 && degrees <= 45) {
                this.onSwipeRight();
            } else if (degrees > 45 && degrees <= 135) {
                this.onSwipeDown();
            } else if (degrees > 135 || degrees <= -135) {
                this.onSwipeLeft();
            } else {
                this.onSwipeUp();
            }
        } else if (this.gesturePoints.length < 10) {
            this.onTap();
        }
    }
    
    onSwipeLeft() { console.log('Swiped left'); }
    onSwipeRight() { console.log('Swiped right'); }
    onSwipeUp() { console.log('Swiped up'); }
    onSwipeDown() { console.log('Swiped down'); }
    onTap() { console.log('Tapped'); }
}
```

### Multi-Touch Gestures
Handle complex multi-touch interactions:

```javascript { .api }
class MultiTouchScene extends Phaser.Scene {
    create() {
        this.pinchStart = null;
        this.initialDistance = 0;
        
        this.input.on('pointerdown', (pointer) => {
            if (this.input.pointer1.isDown && this.input.pointer2.isDown) {
                // Two fingers down - start pinch gesture
                this.startPinch();
            }
        });
        
        this.input.on('pointermove', () => {
            if (this.input.pointer1.isDown && this.input.pointer2.isDown) {
                this.updatePinch();
            }
        });
        
        this.input.on('pointerup', () => {
            if (!this.input.pointer1.isDown || !this.input.pointer2.isDown) {
                this.endPinch();
            }
        });
    }
    
    startPinch() {
        const pointer1 = this.input.pointer1;
        const pointer2 = this.input.pointer2;
        
        this.initialDistance = Phaser.Math.Distance.Between(
            pointer1.x, pointer1.y, 
            pointer2.x, pointer2.y
        );
        
        this.pinchStart = {
            zoom: this.cameras.main.zoom,
            centerX: (pointer1.x + pointer2.x) / 2,
            centerY: (pointer1.y + pointer2.y) / 2
        };
    }
    
    updatePinch() {
        if (!this.pinchStart) return;
        
        const pointer1 = this.input.pointer1;
        const pointer2 = this.input.pointer2;
        
        const currentDistance = Phaser.Math.Distance.Between(
            pointer1.x, pointer1.y,
            pointer2.x, pointer2.y
        );
        
        const scale = currentDistance / this.initialDistance;
        const newZoom = this.pinchStart.zoom * scale;
        
        this.cameras.main.setZoom(Phaser.Math.Clamp(newZoom, 0.5, 3));
    }
    
    endPinch() {
        this.pinchStart = null;
    }
}
```

This comprehensive input system provides all the tools needed to create responsive, multi-platform games that work seamlessly across desktop and mobile devices.