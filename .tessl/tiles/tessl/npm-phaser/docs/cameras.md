# Camera System

Phaser's camera system provides flexible viewport management, smooth following, visual effects, and multi-camera support. Cameras determine what portion of the game world is visible and how it's rendered to the screen.

## Camera Manager

### Basic Camera Setup
Each scene has a camera manager that controls one or more cameras:

```javascript { .api }
class CameraScene extends Phaser.Scene {
    create() {
        // Access the main camera
        const mainCamera = this.cameras.main;
        
        // Camera properties
        console.log('Camera position:', mainCamera.scrollX, mainCamera.scrollY);
        console.log('Camera size:', mainCamera.width, mainCamera.height);
        console.log('Camera zoom:', mainCamera.zoom);
        console.log('Camera bounds:', mainCamera.getBounds());
        
        // Basic camera operations
        mainCamera.setPosition(100, 50);    // Set camera viewport position
        mainCamera.setSize(600, 400);       // Set camera viewport size
        mainCamera.setScroll(200, 100);     // Set world scroll position
        mainCamera.setZoom(1.5);            // Set zoom level
        mainCamera.setRotation(0.1);        // Rotate camera view
        
        // Camera background
        mainCamera.setBackgroundColor('#2c3e50');
        mainCamera.setAlpha(0.8);           // Camera transparency
        mainCamera.setVisible(true);        // Camera visibility
    }
}
```

### Multiple Cameras
Create and manage multiple cameras for split-screen or UI overlays:

```javascript { .api }
class MultiCameraScene extends Phaser.Scene {
    create() {
        // Main camera covers full screen
        const mainCamera = this.cameras.main;
        mainCamera.setViewport(0, 0, 800, 600);
        
        // Add secondary camera for minimap
        const minimap = this.cameras.add(600, 20, 180, 140);
        minimap.setZoom(0.2);
        minimap.setName('minimap');
        minimap.setBackgroundColor('#000000');
        
        // Add UI camera that ignores game objects
        const uiCamera = this.cameras.add(0, 0, 800, 600);
        uiCamera.setName('ui');
        
        // Make UI elements only visible to UI camera
        const healthBar = this.add.rectangle(50, 50, 100, 20, 0xff0000);
        healthBar.setScrollFactor(0, 0); // Don't scroll with main camera
        
        // Ignore specific objects on specific cameras
        mainCamera.ignore(healthBar);      // Main camera doesn't render UI
        uiCamera.ignore([this.player, this.enemies]); // UI camera only renders UI
        
        // Camera management
        const cameras = this.cameras.getCamera('minimap');
        this.cameras.remove(minimap);      // Remove camera
        this.cameras.removeAll();          // Remove all cameras except main
        
        // Camera iteration
        this.cameras.cameras.forEach(camera => {
            console.log('Camera:', camera.name);
        });
    }
}
```

## Camera Movement

### Manual Control
Directly control camera position and properties:

```javascript { .api }
class CameraControlScene extends Phaser.Scene {
    create() {
        this.cameras.main.setScroll(0, 0);
        
        // Keyboard controls
        this.cursors = this.input.keyboard.createCursorKeys();
        this.wasd = this.input.keyboard.addKeys('W,S,A,D');
    }
    
    update() {
        const camera = this.cameras.main;
        const speed = 5;
        
        // WASD camera movement
        if (this.wasd.A.isDown) {
            camera.scrollX -= speed;
        } else if (this.wasd.D.isDown) {
            camera.scrollX += speed;
        }
        
        if (this.wasd.W.isDown) {
            camera.scrollY -= speed;
        } else if (this.wasd.S.isDown) {
            camera.scrollY += speed;
        }
        
        // Mouse wheel zoom
        this.input.on('wheel', (pointer, gameObjects, deltaX, deltaY) => {
            if (deltaY > 0) {
                camera.zoom = Phaser.Math.Clamp(camera.zoom - 0.1, 0.1, 3);
            } else {
                camera.zoom = Phaser.Math.Clamp(camera.zoom + 0.1, 0.1, 3);
            }
        });
        
        // Smooth camera movement with lerp
        const targetScrollX = this.player.x - 400;
        const targetScrollY = this.player.y - 300;
        
        camera.scrollX = Phaser.Math.Linear(camera.scrollX, targetScrollX, 0.05);
        camera.scrollY = Phaser.Math.Linear(camera.scrollY, targetScrollY, 0.05);
    }
}
```

### Camera Following
Make the camera automatically follow game objects:

```javascript { .api }
class CameraFollowScene extends Phaser.Scene {
    create() {
        this.player = this.add.sprite(400, 300, 'player');
        
        // Basic following
        this.cameras.main.startFollow(this.player);
        
        // Following with options
        this.cameras.main.startFollow(
            this.player,           // Target to follow
            false,                 // Round pixels
            0.05,                  // Lerp X (0 = instant, 1 = never catch up)
            0.05,                  // Lerp Y
            0,                     // Offset X
            0                      // Offset Y
        );
        
        // Set follow offset
        this.cameras.main.setFollowOffset(-100, -50);
        
        // Deadzone following (only move when target leaves zone)
        this.cameras.main.setDeadzone(200, 150);
        
        // Linear following with specific lerp values
        this.cameras.main.setLerp(0.1, 0.1);
        
        // Stop following
        this.cameras.main.stopFollow();
        
        // Conditional following
        this.followActive = true;
        if (this.followActive) {
            this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
        }
    }
    
    update() {
        // Dynamic follow target switching
        if (this.input.keyboard.addKey('1').isDown) {
            this.cameras.main.startFollow(this.player);
        } else if (this.input.keyboard.addKey('2').isDown) {
            this.cameras.main.startFollow(this.enemy);
        }
        
        // Adjust follow based on player state
        if (this.player.body.velocity.x > 100) {
            // Look ahead when moving fast
            this.cameras.main.setFollowOffset(50, 0);
        } else {
            this.cameras.main.setFollowOffset(0, 0);
        }
    }
}
```

### Camera Bounds
Constrain camera movement within world boundaries:

```javascript { .api }
class CameraBoundsScene extends Phaser.Scene {
    create() {
        // Set world bounds
        this.physics.world.setBounds(0, 0, 2000, 1200);
        
        // Set camera bounds (camera won't scroll outside these)
        this.cameras.main.setBounds(0, 0, 2000, 1200);
        
        // Camera bounds with centering
        this.cameras.main.setBounds(0, 0, 2000, 1200, true);
        
        // Get current bounds
        const bounds = this.cameras.main.getBounds();
        console.log('Camera bounds:', bounds);
        
        // Remove bounds
        this.cameras.main.removeBounds();
        
        // Dynamic bounds adjustment
        this.events.on('levelComplete', () => {
            // Expand camera bounds for next level
            this.cameras.main.setBounds(0, 0, 3000, 1500);
        });
    }
}
```

## Camera Effects

### Fade Effects
Smooth fade in/out transitions:

```javascript { .api }
class CameraFadeScene extends Phaser.Scene {
    create() {
        // Fade in from black
        this.cameras.main.fadeIn(1000);  // Duration in ms
        
        // Fade out to black
        this.cameras.main.fadeOut(1000);
        
        // Fade to specific color
        this.cameras.main.fadeOut(1000, 255, 0, 0);  // Fade to red
        
        // Fade with callback
        this.cameras.main.fadeOut(1000, 0, 0, 0, (camera, progress) => {
            if (progress === 1) {
                console.log('Fade complete');
                this.scene.start('NextScene');
            }
        });
        
        // Fade events
        this.cameras.main.on('camerafadeincomplete', () => {
            console.log('Fade in complete');
        });
        
        this.cameras.main.on('camerafadeoutcomplete', () => {
            console.log('Fade out complete');
        });
        
        // Check fade status
        console.log('Is fading:', this.cameras.main.fadeEffect.isRunning);
        console.log('Fade progress:', this.cameras.main.fadeEffect.progress);
    }
    
    fadeToScene(sceneKey) {
        this.cameras.main.fadeOut(1000);
        this.cameras.main.once('camerafadeoutcomplete', () => {
            this.scene.start(sceneKey);
        });
    }
}
```

### Flash Effects
Screen flash for impact or attention:

```javascript { .api }
class CameraFlashScene extends Phaser.Scene {
    create() {
        this.player = this.add.sprite(400, 300, 'player');
        
        // White flash
        this.cameras.main.flash(250);  // Duration in ms
        
        // Colored flash
        this.cameras.main.flash(500, 255, 0, 0);  // Red flash
        
        // Flash with callback
        this.cameras.main.flash(300, 255, 255, 0, false, (camera, progress) => {
            if (progress === 1) {
                console.log('Flash complete');
            }
        });
        
        // Flash events
        this.cameras.main.on('cameraflashstart', () => {
            console.log('Flash started');
        });
        
        this.cameras.main.on('cameraflashcomplete', () => {
            console.log('Flash complete');
        });
    }
    
    playerHit() {
        // Flash red when player takes damage
        this.cameras.main.flash(200, 255, 0, 0);
    }
    
    powerUpCollected() {
        // Flash yellow when power-up collected
        this.cameras.main.flash(300, 255, 255, 0);
    }
}
```

### Shake Effects
Screen shake for explosions and impacts:

```javascript { .api }
class CameraShakeScene extends Phaser.Scene {
    create() {
        this.player = this.add.sprite(400, 300, 'player');
        
        // Basic shake
        this.cameras.main.shake(500);  // Duration in ms
        
        // Shake with intensity
        this.cameras.main.shake(1000, 0.05);  // Intensity (0-1)
        
        // Shake with direction
        this.cameras.main.shake(300, 0.02, true);  // Force horizontal shake
        
        // Shake with callback
        this.cameras.main.shake(500, 0.03, false, (camera, progress) => {
            if (progress === 1) {
                console.log('Shake complete');
            }
        });
        
        // Shake events
        this.cameras.main.on('camerashakestart', () => {
            console.log('Shake started');
        });
        
        this.cameras.main.on('camerashakecomplete', () => {
            console.log('Shake complete');
        });
    }
    
    explosion(x, y) {
        // Calculate shake intensity based on distance
        const distance = Phaser.Math.Distance.Between(
            this.cameras.main.scrollX + 400,
            this.cameras.main.scrollY + 300,
            x, y
        );
        
        const intensity = Phaser.Math.Clamp(1 - (distance / 500), 0, 0.1);
        
        if (intensity > 0) {
            this.cameras.main.shake(300, intensity);
        }
    }
}
```

### Pan Effects
Smooth camera panning to targets:

```javascript { .api }
class CameraPanScene extends Phaser.Scene {
    create() {
        this.player = this.add.sprite(100, 300, 'player');
        this.treasure = this.add.sprite(700, 200, 'treasure');
        
        // Pan to coordinates
        this.cameras.main.pan(700, 200, 2000);  // x, y, duration
        
        // Pan with easing
        this.cameras.main.pan(400, 300, 1500, 'Power2', false, (camera, progress, x, y) => {
            if (progress === 1) {
                console.log('Pan complete');
            }
        });
        
        // Pan events
        this.cameras.main.on('camerapanstart', () => {
            console.log('Pan started');
        });
        
        this.cameras.main.on('camerapancomplete', () => {
            console.log('Pan complete');
        });
    }
    
    showTreasure() {
        // Pan to treasure location
        this.cameras.main.stopFollow();  // Stop following player
        this.cameras.main.pan(this.treasure.x, this.treasure.y, 1000);
        
        this.cameras.main.once('camerapancomplete', () => {
            // Wait a moment then return to player
            this.time.delayedCall(2000, () => {
                this.cameras.main.pan(this.player.x, this.player.y, 1000);
                this.cameras.main.once('camerapancomplete', () => {
                    this.cameras.main.startFollow(this.player);
                });
            });
        });
    }
}
```

### Zoom Effects
Smooth camera zooming:

```javascript { .api }
class CameraZoomScene extends Phaser.Scene {
    create() {
        this.player = this.add.sprite(400, 300, 'player');
        
        // Zoom to level
        this.cameras.main.zoomTo(2, 1000);  // Zoom level, duration
        
        // Zoom with easing and callback
        this.cameras.main.zoomTo(0.5, 2000, 'Power2', false, (camera, progress, zoom) => {
            if (progress === 1) {
                console.log('Zoom complete, final zoom:', zoom);
            }
        });
        
        // Zoom events
        this.cameras.main.on('camerazoomstart', () => {
            console.log('Zoom started');
        });
        
        this.cameras.main.on('camerazoomcomplete', () => {
            console.log('Zoom complete');
        });
    }
    
    enterBossArea() {
        // Zoom out to show boss arena
        this.cameras.main.zoomTo(0.7, 1500, 'Power2');
        this.cameras.main.pan(this.bossArena.x, this.bossArena.y, 1500);
    }
    
    focusOnPlayer() {
        // Zoom in for dramatic effect
        this.cameras.main.zoomTo(1.5, 1000, 'Back.easeOut');
    }
}
```

### Rotation Effects
Rotate camera view:

```javascript { .api }
class CameraRotationScene extends Phaser.Scene {
    create() {
        this.player = this.add.sprite(400, 300, 'player');
        
        // Rotate to angle
        this.cameras.main.rotateTo(0.5, false, 1000);  // angle, shortestPath, duration
        
        // Rotate with easing and callback
        this.cameras.main.rotateTo(-0.3, true, 2000, 'Sine.easeInOut', false, (camera, progress, angle) => {
            if (progress === 1) {
                console.log('Rotation complete, final angle:', angle);
            }
        });
        
        // Rotation events
        this.cameras.main.on('camerarotatestart', () => {
            console.log('Rotation started');
        });
        
        this.cameras.main.on('camerarotatecomplete', () => {
            console.log('Rotation complete');
        });
    }
    
    earthquake() {
        // Random rotation for earthquake effect
        const angle = Phaser.Math.FloatBetween(-0.1, 0.1);
        this.cameras.main.rotateTo(angle, false, 100);
        
        this.cameras.main.once('camerarotatecomplete', () => {
            this.cameras.main.rotateTo(0, false, 100);
        });
    }
}
```

## Camera Controls

### Built-in Camera Controls
Phaser provides pre-built camera control schemes:

```javascript { .api }
class CameraControlsScene extends Phaser.Scene {
    create() {
        // Smoothed key control
        const controlConfig = {
            camera: this.cameras.main,
            left: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
            right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
            up: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
            down: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
            zoomIn: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
            zoomOut: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E),
            acceleration: 0.06,
            drag: 0.0005,
            maxSpeed: 1.0,
            zoomSpeed: 0.02
        };
        
        this.controls = new Phaser.Cameras.Controls.SmoothedKeyControl(controlConfig);
        
        // Fixed key control (immediate response)
        const fixedConfig = {
            camera: this.cameras.main,
            left: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
            right: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
            up: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
            down: this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
            speed: 0.5
        };
        
        this.fixedControls = new Phaser.Cameras.Controls.FixedKeyControl(fixedConfig);
    }
    
    update(time, delta) {
        // Update camera controls
        if (this.controls) {
            this.controls.update(delta);
        }
    }
}
```

### Custom Camera Controls
Create custom camera control systems:

```javascript { .api }
class CustomCameraControlsScene extends Phaser.Scene {
    create() {
        this.cameras.main.setZoom(1);
        
        // Mouse drag camera
        this.input.on('pointerdown', () => {
            this.isDragging = true;
            this.dragStartX = this.input.activePointer.x;
            this.dragStartY = this.input.activePointer.y;
            this.cameraStartX = this.cameras.main.scrollX;
            this.cameraStartY = this.cameras.main.scrollY;
        });
        
        this.input.on('pointermove', (pointer) => {
            if (this.isDragging) {
                const dragX = pointer.x - this.dragStartX;
                const dragY = pointer.y - this.dragStartY;
                
                this.cameras.main.setScroll(
                    this.cameraStartX - dragX,
                    this.cameraStartY - dragY
                );
            }
        });
        
        this.input.on('pointerup', () => {
            this.isDragging = false;
        });
        
        // Edge scrolling
        this.input.on('pointermove', (pointer) => {
            const edgeThreshold = 50;
            const scrollSpeed = 5;
            
            if (pointer.x < edgeThreshold) {
                this.cameras.main.scrollX -= scrollSpeed;
            } else if (pointer.x > this.game.config.width - edgeThreshold) {
                this.cameras.main.scrollX += scrollSpeed;
            }
            
            if (pointer.y < edgeThreshold) {
                this.cameras.main.scrollY -= scrollSpeed;
            } else if (pointer.y > this.game.config.height - edgeThreshold) {
                this.cameras.main.scrollY += scrollSpeed;
            }
        });
        
        // Touch pinch zoom
        this.setupPinchZoom();
    }
    
    setupPinchZoom() {
        let initialDistance = 0;
        let initialZoom = 1;
        
        this.input.on('pointerdown', (pointer) => {
            if (this.input.pointer1.isDown && this.input.pointer2.isDown) {
                initialDistance = Phaser.Math.Distance.Between(
                    this.input.pointer1.x, this.input.pointer1.y,
                    this.input.pointer2.x, this.input.pointer2.y
                );
                initialZoom = this.cameras.main.zoom;
            }
        });
        
        this.input.on('pointermove', () => {
            if (this.input.pointer1.isDown && this.input.pointer2.isDown) {
                const currentDistance = Phaser.Math.Distance.Between(
                    this.input.pointer1.x, this.input.pointer1.y,
                    this.input.pointer2.x, this.input.pointer2.y
                );
                
                const scale = currentDistance / initialDistance;
                const newZoom = initialZoom * scale;
                
                this.cameras.main.setZoom(Phaser.Math.Clamp(newZoom, 0.5, 3));
            }
        });
    }
}
```

## Advanced Camera Features

### Camera Culling
Optimize performance by culling off-screen objects:

```javascript { .api }
class CameraCullingScene extends Phaser.Scene {
    create() {
        // Disable culling for specific objects
        this.cameras.main.disableCull = false;  // Enable culling (default)
        
        // Objects outside camera view won't be rendered
        this.backgroundObjects = this.add.group();
        
        // Force objects to always render (ignore culling)
        this.ui = this.add.text(10, 10, 'Score: 0');
        this.ui.setScrollFactor(0); // UI doesn't scroll with camera
        
        // Custom culling for specific objects
        this.particles = this.add.particles(0, 0, 'particle');
        
        // Check if object is visible to camera
        const isVisible = this.cameras.main.worldView.contains(this.player.x, this.player.y);
        
        // Get camera world view
        const worldView = this.cameras.main.worldView;
        console.log('Camera world view:', worldView);
    }
    
    update() {
        // Manual culling for performance
        this.backgroundObjects.children.entries.forEach(obj => {
            const inView = this.cameras.main.worldView.contains(obj.x, obj.y);
            obj.setVisible(inView);
        });
    }
}
```

### Camera Masks
Use masks to create interesting visual effects:

```javascript { .api }
class CameraMaskScene extends Phaser.Scene {
    create() {
        // Create mask shape
        const maskShape = this.add.graphics();
        maskShape.fillStyle(0xffffff);
        maskShape.fillCircle(400, 300, 150);
        
        // Apply mask to camera
        const mask = maskShape.createGeometryMask();
        this.cameras.main.setMask(mask);
        
        // Bitmap mask
        const bitmapMask = this.add.image(400, 300, 'maskTexture');
        const mask2 = bitmapMask.createBitmapMask();
        this.cameras.main.setMask(mask2);
        
        // Clear mask
        this.cameras.main.clearMask();
        
        // Animate mask
        this.tweens.add({
            targets: maskShape,
            scaleX: 2,
            scaleY: 2,
            duration: 2000,
            yoyo: true,
            repeat: -1
        });
    }
}
```

This comprehensive camera system provides all the tools needed to create dynamic, engaging visual experiences with smooth movement, dramatic effects, and flexible viewport management.