# Game Objects

Game Objects are the visual and interactive elements that make up your game. Phaser provides an extensive collection of built-in game objects, from simple sprites to complex particle systems.

## Core Game Objects

### Sprite
Dynamic textured objects with animation and physics support.

```javascript { .api }
// Basic sprite creation
const sprite = scene.add.sprite(x, y, 'texture', frame);

// With physics
const physicsSprite = scene.physics.add.sprite(x, y, 'texture');

// Animation support
sprite.play('walkAnimation');
sprite.setFrame(frameIndex);

// Transform properties
sprite.setPosition(x, y);
sprite.setScale(scaleX, scaleY);
sprite.setRotation(radians);
sprite.setOrigin(originX, originY);

// Visual properties
sprite.setTint(0xff0000);
sprite.setAlpha(0.5);
sprite.setVisible(false);
sprite.setDepth(10);
```

**Key Methods:**
- `setTexture(key, frame)` - Change texture
- `setFrame(frame)` - Change animation frame
- `play(animKey, ignoreIfPlaying, startFrame)` - Play animation
- `setInteractive()` - Enable input events

### Image
Static textured display objects (no animation support).

```javascript { .api }
// Basic image creation
const image = scene.add.image(x, y, 'texture');

// Chaining methods
const logo = scene.add.image(400, 300, 'logo')
    .setOrigin(0.5)
    .setScale(2)
    .setTint(0x00ff00);

// Load from URL at runtime
scene.load.image('runtime', 'https://example.com/image.png');
scene.load.once('complete', () => {
    scene.add.image(100, 100, 'runtime');
});
```

**Key Methods:**
- `setTexture(key, frame)` - Change texture
- `setCrop(x, y, width, height)` - Crop image area

### Text
Bitmap and web font text rendering.

```javascript { .api }
// Basic text
const text = scene.add.text(x, y, 'Hello World', {
    fontFamily: 'Arial',
    fontSize: '32px',
    fill: '#ffffff'
});

// Advanced styling
const styledText = scene.add.text(100, 100, 'Styled Text', {
    fontFamily: 'Georgia, serif',
    fontSize: '24px',
    fill: '#ff0000',
    stroke: '#000000',
    strokeThickness: 4,
    align: 'center',
    backgroundColor: '#ffffff',
    padding: { x: 10, y: 5 },
    shadow: {
        offsetX: 2,
        offsetY: 2,
        color: '#000000',
        blur: 2,
        fill: true
    }
});

// Dynamic text updates
text.setText('New Content');
text.setStyle({ fontSize: '48px', fill: '#00ff00' });

// Multiline text
const multiline = scene.add.text(50, 50, 'Line 1\nLine 2\nLine 3', {
    fontSize: '20px',
    align: 'left',
    lineSpacing: 10
});

// Word wrapping
const wrapped = scene.add.text(10, 10, 'This is a very long text that will wrap', {
    fontSize: '16px',
    wordWrap: { width: 300, useAdvancedWrap: true }
});
```

**Key Methods:**
- `setText(text)` - Update text content  
- `setStyle(style)` - Update text style
- `setWordWrapWidth(width)` - Set wrap width

### BitmapText
High-performance text using bitmap fonts.

```javascript { .api }
// Load bitmap font
scene.load.bitmapFont('pixelFont', 'assets/fonts/pixel.png', 'assets/fonts/pixel.xml');

// Create bitmap text
const bitmapText = scene.add.bitmapText(x, y, 'pixelFont', 'Bitmap Text');

// Dynamic bitmap text with effects
const dynamicText = scene.add.dynamicBitmapText(x, y, 'pixelFont', 'Dynamic Text')
    .setScale(2)
    .setTint(0xff0000);

// Letter spacing and alignment
bitmapText.setLetterSpacing(10);
bitmapText.setCenterAlign();
```

**Key Methods:**
- `setText(text)` - Update text
- `setFont(font)` - Change font
- `setLetterSpacing(spacing)` - Adjust spacing

### Graphics
Vector graphics drawing and shapes.

```javascript { .api }
// Create graphics object
const graphics = scene.add.graphics();

// Drawing shapes
graphics.fillStyle(0xff0000);
graphics.fillRect(50, 50, 100, 100);

graphics.lineStyle(4, 0x00ff00);
graphics.strokeRect(200, 50, 100, 100);

// Complex drawing
graphics.clear();
graphics.fillStyle(0x0000ff, 0.8);
graphics.beginPath();
graphics.moveTo(100, 100);
graphics.lineTo(200, 150);
graphics.lineTo(50, 200);
graphics.closePath();
graphics.fillPath();

// Circles and ellipses
graphics.fillCircle(300, 300, 50);
graphics.strokeEllipse(400, 300, 60, 40);

// Gradients (WebGL only)
graphics.fillGradientStyle(0xff0000, 0x0000ff, 0x00ff00, 0xffff00, 1);
graphics.fillRect(0, 0, 100, 100);

// Line styles
graphics.lineStyle(8, 0xffffff, 1);
graphics.lineBetween(0, 0, 400, 300);
```

**Key Methods:**
- `clear()` - Clear all graphics
- `fillStyle(color, alpha)` - Set fill style
- `lineStyle(width, color, alpha)` - Set line style
- `beginPath()` / `closePath()` - Path drawing

### Container
Group and transform multiple game objects together.

```javascript { .api }
// Create container
const container = scene.add.container(x, y);

// Add children
const sprite1 = scene.add.sprite(0, 0, 'texture1');
const sprite2 = scene.add.sprite(50, 50, 'texture2');
container.add([sprite1, sprite2]);

// Container transforms affect all children
container.setPosition(200, 200);
container.setScale(1.5);
container.setRotation(Phaser.Math.DegToRad(45));

// Individual child access
const child = container.getAt(0);
container.bringToTop(sprite2);
container.remove(sprite1);

// Batch operations
container.setAlpha(0.5); // Affects all children
container.setVisible(false);

// Local coordinates
const localX = container.x + sprite1.x;
const localY = container.y + sprite1.y;
```

**Key Methods:**
- `add(child)` - Add child object
- `remove(child)` - Remove child
- `removeAll()` - Remove all children
- `getAt(index)` - Get child by index

## Shape Objects

### Rectangle
Vector rectangle shapes.

```javascript { .api }
// Basic rectangle
const rect = scene.add.rectangle(x, y, width, height, fillColor);

// Styled rectangle
const styledRect = scene.add.rectangle(200, 200, 100, 50, 0xff0000)
    .setStrokeStyle(4, 0x00ff00)
    .setAlpha(0.8);

// Interactive rectangle
rect.setInteractive();
rect.on('pointerdown', () => {
    rect.setFillStyle(Phaser.Utils.Array.GetRandom([0xff0000, 0x00ff00, 0x0000ff]));
});
```

### Circle/Arc
Circular and arc shapes.

```javascript { .api }
// Full circle
const circle = scene.add.circle(x, y, radius, fillColor);

// Arc segment
const arc = scene.add.arc(x, y, radius, startAngle, endAngle, anticlockwise, fillColor);

// Pie slice
const pie = scene.add.arc(200, 200, 80, 0, Phaser.Math.DegToRad(120), false, 0xff0000)
    .setStrokeStyle(3, 0x000000);

// Dynamic arc
arc.startAngle = Phaser.Math.DegToRad(45);
arc.endAngle = Phaser.Math.DegToRad(270);
```

### Ellipse
Elliptical shapes.

```javascript { .api }
// Basic ellipse
const ellipse = scene.add.ellipse(x, y, width, height, fillColor);

// Styled ellipse with stroke
const styledEllipse = scene.add.ellipse(300, 200, 120, 80, 0x00ff00)
    .setStrokeStyle(2, 0x0000ff);
```

### Line
Vector lines and polylines.

```javascript { .api }
// Single line
const line = scene.add.line(x, y, x1, y1, x2, y2, strokeColor);

// Styled line
const styledLine = scene.add.line(400, 300, 0, 0, 100, 100, 0xff0000)
    .setLineWidth(5);

// Update line endpoints
line.setTo(newX1, newY1, newX2, newY2);
```

### Polygon
Complex polygon shapes.

```javascript { .api }
// Triangle
const triangle = scene.add.triangle(x, y, x1, y1, x2, y2, x3, y3, fillColor);

// Star shape
const star = scene.add.star(x, y, points, innerRadius, outerRadius, fillColor);

// Custom polygon from points
const polygon = scene.add.polygon(x, y, [
    0, 50,     // Point 1
    50, 0,     // Point 2  
    100, 50,   // Point 3
    50, 100    // Point 4
], fillColor);
```

### Grid
Grid pattern shapes.

```javascript { .api }
// Basic grid
const grid = scene.add.grid(x, y, width, height, cellWidth, cellHeight, fillColor);

// Styled grid with alternating colors
const chessboard = scene.add.grid(400, 300, 320, 320, 40, 40, 0xffffff, 1, 0x000000, 1);

// Grid with stroke
grid.setStrokeStyle(1, 0x000000);
```

## Advanced Game Objects

### TileSprite
Repeating tiled textures.

```javascript { .api }
// Basic tile sprite
const tileSprite = scene.add.tileSprite(x, y, width, height, 'texture');

// Scrolling background
const scrollingBg = scene.add.tileSprite(0, 0, 800, 600, 'background')
    .setOrigin(0);

// Animate tiling
scene.tweens.add({
    targets: scrollingBg,
    tilePositionX: 500,
    duration: 3000,
    repeat: -1
});

// Update tile position manually
tileSprite.tilePositionX += 1;
tileSprite.tilePositionY += 0.5;
```

### Video
Video playback objects.

```javascript { .api }
// Load video
scene.load.video('intro', 'assets/intro.mp4');

// Create video object
const video = scene.add.video(400, 300, 'intro');

// Playback control
video.play();
video.pause();
video.stop();
video.setLoop(true);

// Video events
video.on('play', () => console.log('Video started'));
video.on('complete', () => console.log('Video finished'));

// Video as texture
const videoSprite = scene.add.sprite(400, 300, video);
```

### Zone
Invisible interactive areas.

```javascript { .api }
// Create invisible zone
const zone = scene.add.zone(x, y, width, height);

// Make zone interactive
zone.setInteractive();
zone.on('pointerenter', () => {
    console.log('Entered zone');
});

// Drop zone
zone.setRectangleDropZone(width, height);
zone.on('drop', (pointer, gameObject) => {
    gameObject.x = zone.x;
    gameObject.y = zone.y;
});

// Circular zone
const circularZone = scene.add.zone(300, 300, 100, 100)
    .setCircleDropZone(50);
```

### RenderTexture
Dynamic textures for drawing operations.

```javascript { .api }
// Create render texture
const renderTexture = scene.add.renderTexture(x, y, width, height);

// Draw objects to texture
renderTexture.draw(sprite, 100, 100);
renderTexture.drawFrame('atlas', 'frame', 0, 0);

// Render texture operations
renderTexture.clear();
renderTexture.fill(0xff0000);
renderTexture.stamp('texture', 50, 50);

// Use render texture
const resultSprite = scene.add.sprite(400, 300, renderTexture.texture);

// Save render texture
renderTexture.snapshot((image) => {
    // Use image data
});
```

### Blitter
High-performance sprite batching system.

```javascript { .api }
// Create blitter
const blitter = scene.add.blitter(0, 0, 'texture');

// Add bob objects (lightweight sprites)
const bob1 = blitter.create(100, 100);
const bob2 = blitter.create(200, 200, 'frame2');

// Bob properties
bob1.setPosition(150, 150);
bob1.setScale(2);
bob1.setAlpha(0.5);
bob1.setTint(0xff0000);

// Batch operations for performance
for (let i = 0; i < 1000; i++) {
    blitter.create(
        Phaser.Math.Between(0, 800),
        Phaser.Math.Between(0, 600)
    );
}
```

## WebGL-Specific Objects

### Shader
Custom WebGL shaders.

```javascript { .api }
// Load shader
scene.load.glsl('plasma', 'shaders/plasma.frag');

// Create shader object
const shader = scene.add.shader('plasma', x, y, width, height);

// Shader uniforms
shader.setUniform('time.value', 0);
shader.setUniform('resolution.value.x', width);
shader.setUniform('resolution.value.y', height);

// Animate shader
scene.tweens.add({
    targets: shader,
    'uniforms.time.value': 10,
    duration: 5000,
    repeat: -1,
    yoyo: true
});
```

### Mesh
3D mesh objects.

```javascript { .api }
// Create mesh
const mesh = scene.add.mesh(x, y, 'texture');

// Set vertices (quad example)
mesh.addVertices([
    -50, -50,  0,  0, // Top-left
     50, -50,  1,  0, // Top-right
    -50,  50,  0,  1, // Bottom-left
     50,  50,  1,  1  // Bottom-right
], [0, 1, 2, 2, 1, 3]);

// 3D rotation
mesh.rotateX += 0.01;
mesh.rotateY += 0.01;

// Perspective
mesh.setPerspective(width, height, 45);
```

### PointLight
2D point lights for lighting effects.

```javascript { .api }
// Enable lighting on scene
scene.lights.enable();
scene.lights.setAmbientColor(0x404040);

// Create point light
const light = scene.add.pointlight(x, y, color, radius, intensity);

// Light properties
light.color.setTo(255, 100, 100);
light.radius = 200;
light.intensity = 0.8;

// Animated light
scene.tweens.add({
    targets: light,
    radius: 300,
    intensity: 1.2,
    duration: 2000,
    yoyo: true,
    repeat: -1
});
```

## Particle Systems

### Particle Emitters
Complex particle effects.

```javascript { .api }
// Create emitter
const particles = scene.add.particles(x, y, 'texture', {
    speed: { min: 100, max: 200 },
    scale: { start: 0.5, end: 0 },
    lifespan: 300,
    quantity: 2
});

// Advanced particle configuration
const explosion = scene.add.particles(400, 300, 'particle', {
    speed: { min: 150, max: 250 },
    scale: { start: 1, end: 0.3 },
    rotate: { min: -180, max: 180 },
    alpha: { start: 1, end: 0 },
    tint: [0xff0000, 0xff8800, 0xffff00],
    lifespan: 500,
    quantity: 50,
    frequency: 100,
    emitZone: {
        type: 'edge',
        source: new Phaser.Geom.Circle(0, 0, 50),
        quantity: 20
    }
});

// Control emission
particles.start();
particles.stop();
particles.explode(50); // Burst of 50 particles

// Follow target
particles.startFollow(player);
particles.stopFollow();

// Dynamic properties
particles.setSpeed({ min: 50, max: 150 });
particles.setLifespan(1000);
```

## Object Management

### GameObject Factory (scene.add)
Creates objects and adds them to display list.

```javascript { .api }
// Factory methods return the created object
const sprite = scene.add.sprite(x, y, 'texture');
const text = scene.add.text(x, y, 'Hello');
const group = scene.add.group();

// Chaining for configuration
const configuredSprite = scene.add.sprite(100, 100, 'player')
    .setScale(2)
    .setTint(0xff0000)
    .setInteractive();
```

### GameObject Creator (scene.make)
Creates objects without adding to display list.

```javascript { .api }
// Creator methods for manual management
const sprite = scene.make.sprite({
    x: 100,
    y: 100,
    key: 'texture',
    add: false // Don't add to display list
});

// Add to display list manually
scene.add.existing(sprite);

// Or add to container
container.add(sprite);
```

### Groups
Collections of game objects.

```javascript { .api }
// Create group
const enemies = scene.add.group();

// Add objects to group
enemies.add(enemy1);
enemies.add(enemy2);
enemies.addMultiple([enemy3, enemy4, enemy5]);

// Create objects in group
enemies.create(100, 100, 'enemy');
enemies.createMultiple({
    key: 'enemy',
    quantity: 10,
    setXY: { x: 100, y: 100, stepX: 50 }
});

// Group operations
enemies.setAlpha(0.5); // Apply to all children
enemies.setVelocityX(100); // If physics enabled

// Group callbacks
enemies.children.iterate((enemy) => {
    enemy.setTint(0xff0000);
});

// Physics groups
const physicsGroup = scene.physics.add.group();
```

### Layer
Display layers for z-index management.

```javascript { .api }
// Create layer
const backgroundLayer = scene.add.layer();
const gameLayer = scene.add.layer();
const uiLayer = scene.add.layer();

// Add objects to layers
backgroundLayer.add(background);
gameLayer.add([player, enemies]);
uiLayer.add([healthBar, score]);

// Layer properties
backgroundLayer.setAlpha(0.8);
gameLayer.setVisible(false);
uiLayer.setScrollFactor(0); // UI stays fixed to camera
```

## Component System

Game objects use a component-based architecture for shared functionality:

### Transform Components
```javascript { .api }
// Position
gameObject.x = 100;
gameObject.y = 200;
gameObject.setPosition(x, y);

// Scale
gameObject.scaleX = 2;
gameObject.scaleY = 0.5;
gameObject.setScale(x, y);

// Rotation
gameObject.rotation = Phaser.Math.DegToRad(45);
gameObject.setRotation(radians);

// Origin
gameObject.originX = 0.5;
gameObject.originY = 0;
gameObject.setOrigin(x, y);
```

### Visual Components
```javascript { .api }
// Alpha
gameObject.alpha = 0.5;
gameObject.setAlpha(0.8);

// Tint
gameObject.tint = 0xff0000;
gameObject.setTint(0x00ff00);

// Blend mode
gameObject.blendMode = Phaser.BlendModes.ADD;
gameObject.setBlendMode(Phaser.BlendModes.MULTIPLY);

// Depth
gameObject.depth = 10;
gameObject.setDepth(5);

// Visibility
gameObject.visible = false;
gameObject.setVisible(true);
```

### Input Components
```javascript { .api }
// Make interactive
gameObject.setInteractive();

// Custom hit areas
gameObject.setInteractive(new Phaser.Geom.Rectangle(0, 0, 100, 50));
gameObject.setInteractive(new Phaser.Geom.Circle(25, 25, 25));

// Input events
gameObject.on('pointerdown', handleClick);
gameObject.on('pointerover', handleHover);
gameObject.on('drag', handleDrag);

// Enable dragging
gameObject.setInteractive({ draggable: true });
```

This comprehensive game object system provides the foundation for creating rich, interactive games with Phaser's powerful rendering and component architecture.