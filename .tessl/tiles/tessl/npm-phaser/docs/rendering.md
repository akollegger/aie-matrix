# Rendering and Display Systems

Phaser's rendering system provides flexible WebGL and Canvas rendering with comprehensive texture management, visual effects, and display utilities. The system automatically chooses the best available renderer while providing fine-grained control over rendering operations.

## Renderer System

### Renderer Types and Configuration
Phaser supports multiple rendering backends:

```javascript { .api }
// Game configuration with renderer settings
const config = {
    type: Phaser.AUTO,          // Auto-detect best renderer
    // type: Phaser.WEBGL,      // Force WebGL
    // type: Phaser.CANVAS,     // Force Canvas
    // type: Phaser.HEADLESS,   // No rendering (testing)
    
    width: 800,
    height: 600,
    
    render: {
        antialias: true,         // Enable anti-aliasing
        pixelArt: false,         // Optimize for pixel art
        autoResize: true,        // Auto-resize canvas
        roundPixels: true,       // Round pixel positions
        transparent: false,      // Transparent canvas background
        clearBeforeRender: true, // Clear canvas each frame
        preserveDrawingBuffer: false, // Keep drawing buffer (screenshots)
        failIfMajorPerformanceCaveat: false, // Fail on poor performance
        powerPreference: 'default', // 'high-performance' or 'low-power'
        batchSize: 4096,        // WebGL batch size
        maxLights: 10,          // Maximum point lights
        maxTextures: -1,        // Maximum texture units (-1 = auto)
        mipmapFilter: 'LINEAR'  // Mipmap filtering
    },
    
    backgroundColor: '#2c3e50', // Canvas background color
    
    canvas: document.getElementById('game-canvas'), // Existing canvas
    canvasStyle: 'width: 100%; height: 100%;',    // Canvas CSS
    
    scene: RenderingScene
};

class RenderingScene extends Phaser.Scene {
    create() {
        // Access renderer information
        const renderer = this.renderer;
        
        console.log('Renderer type:', renderer.type);
        console.log('WebGL:', renderer.type === Phaser.WEBGL);
        console.log('Canvas size:', renderer.width, renderer.height);
        console.log('Max texture size:', renderer.maxTextureSize);
        
        if (renderer.gl) {
            console.log('WebGL context:', renderer.gl);
            console.log('Extensions:', renderer.extensions);
            console.log('Max textures:', renderer.maxTextures);
        }
    }
}
```

### WebGL Renderer Features
Advanced WebGL-specific rendering capabilities:

```javascript { .api }
class WebGLRenderingScene extends Phaser.Scene {
    create() {
        if (this.renderer.type === Phaser.WEBGL) {
            const gl = this.renderer.gl;
            const renderer = this.renderer;
            
            // WebGL state management
            renderer.setBlendMode(Phaser.BlendModes.ADD);
            renderer.pushScissor(100, 100, 200, 150); // Clip region
            renderer.popScissor(); // Restore previous clip
            
            // Texture binding
            renderer.setTexture2D(this.textures.get('myTexture'), 0);
            renderer.resetTextures();
            
            // Batch management
            renderer.flush(); // Force render current batch
            
            // Framebuffer operations
            const framebuffer = renderer.createFramebuffer(256, 256, null, false);
            renderer.setFramebuffer(framebuffer);
            renderer.setFramebuffer(null); // Back to main framebuffer
            
            // Custom WebGL operations
            this.setupCustomWebGL();
        }
    }
    
    setupCustomWebGL() {
        const gl = this.renderer.gl;
        
        // Create custom shader program
        const vertexShaderSource = `
            attribute vec2 a_position;
            attribute vec2 a_texCoord;
            uniform mat3 u_matrix;
            varying vec2 v_texCoord;
            
            void main() {
                vec3 position = u_matrix * vec3(a_position, 1.0);
                gl_Position = vec4(position, 1.0);
                v_texCoord = a_texCoord;
            }
        `;
        
        const fragmentShaderSource = `
            precision mediump float;
            varying vec2 v_texCoord;
            uniform sampler2D u_texture;
            uniform float u_time;
            
            void main() {
                vec4 color = texture2D(u_texture, v_texCoord);
                color.rgb *= 0.5 + 0.5 * sin(u_time);
                gl_FragColor = color;
            }
        `;
        
        // Compile shaders (simplified - use Phaser's shader system in practice)
        this.customShader = this.createShaderProgram(vertexShaderSource, fragmentShaderSource);
    }
}
```

## Texture Management

### Texture System
Comprehensive texture loading and management:

```javascript { .api }
class TextureManagementScene extends Phaser.Scene {
    preload() {
        // Load various texture types
        this.load.image('logo', 'assets/logo.png');
        this.load.atlas('sprites', 'assets/sprites.png', 'assets/sprites.json');
        this.load.spritesheet('tiles', 'assets/tiles.png', {
            frameWidth: 32,
            frameHeight: 32
        });
    }
    
    create() {
        // Access texture manager
        const textures = this.textures;
        
        // Texture operations
        console.log('Texture exists:', textures.exists('logo'));
        console.log('All texture keys:', textures.getTextureKeys());
        
        // Get texture and frame
        const logoTexture = textures.get('logo');
        const spriteFrame = textures.getFrame('sprites', 'character.png');
        
        // Create runtime textures
        this.createRuntimeTextures();
        
        // Texture manipulation
        this.manipulateTextures();
        
        // Generate textures procedurally
        this.generateTextures();
    }
    
    createRuntimeTextures() {
        // Canvas texture
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        
        // Draw on canvas
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(64, 0, 64, 64);
        ctx.fillStyle = '#0000ff';
        ctx.fillRect(0, 64, 64, 64);
        ctx.fillStyle = '#ffff00';
        ctx.fillRect(64, 64, 64, 64);
        
        // Add to texture manager
        this.textures.addCanvas('colorGrid', canvas);
        
        // Base64 texture
        this.textures.addBase64('base64Texture', 'data:image/png;base64,iVBORw0KGgoAAAANSUh...');
        
        // Create from ImageData
        const imageData = ctx.getImageData(0, 0, 128, 128);
        this.textures.addImage('imageData', imageData);
        
        // Use created textures
        this.add.image(100, 100, 'colorGrid');
    }
    
    manipulateTextures() {
        // Clone texture frame
        const clonedFrame = this.textures.cloneFrame('logo', '__BASE');
        
        // Get pixel color
        const pixelColor = this.textures.getPixel(50, 50, 'logo');
        console.log('Pixel color:', pixelColor);
        
        // Get pixel alpha
        const pixelAlpha = this.textures.getPixelAlpha(50, 50, 'logo');
        console.log('Pixel alpha:', pixelAlpha);
        
        // Texture as base64
        const base64 = this.textures.getBase64('logo');
        console.log('Texture as base64 length:', base64.length);
        
        // Set texture filter
        this.textures.setFilter('logo', 1); // 0 = nearest, 1 = linear
    }
    
    generateTextures() {
        // Procedural noise texture
        const noiseTexture = this.textures.createCanvas('noise', 256, 256);
        const ctx = noiseTexture.getContext('2d');
        const imageData = ctx.getImageData(0, 0, 256, 256);
        const data = imageData.data;
        
        for (let i = 0; i < data.length; i += 4) {
            const noise = Math.random() * 255;
            data[i] = noise;     // Red
            data[i + 1] = noise; // Green
            data[i + 2] = noise; // Blue
            data[i + 3] = 255;   // Alpha
        }
        
        ctx.putImageData(imageData, 0, 0);
        noiseTexture.refresh();
        
        // Gradient texture
        const gradientTexture = this.textures.createCanvas('gradient', 256, 64);
        const gradCtx = gradientTexture.getContext('2d');
        const gradient = gradCtx.createLinearGradient(0, 0, 256, 0);
        gradient.addColorStop(0, '#ff0000');
        gradient.addColorStop(0.5, '#00ff00');
        gradient.addColorStop(1, '#0000ff');
        
        gradCtx.fillStyle = gradient;
        gradCtx.fillRect(0, 0, 256, 64);
        gradientTexture.refresh();
        
        // Use generated textures
        this.add.image(300, 200, 'noise');
        this.add.image(300, 300, 'gradient');
    }
}
```

### Render Textures
Dynamic textures for rendering operations:

```javascript { .api }
class RenderTextureScene extends Phaser.Scene {
    create() {
        // Create render texture
        this.renderTexture = this.add.renderTexture(400, 300, 400, 300);
        
        // Create objects to draw
        const sprite = this.add.sprite(0, 0, 'player');
        const graphics = this.add.graphics();
        graphics.fillStyle(0xff0000);
        graphics.fillCircle(50, 50, 30);
        
        // Draw to render texture
        this.renderTexture.draw(sprite, 100, 100);
        this.renderTexture.draw(graphics, 200, 150);
        
        // Draw texture frame
        this.renderTexture.drawFrame('atlas', 'frame1', 50, 200);
        
        // Batch drawing
        const objects = [sprite, graphics];
        objects.forEach((obj, index) => {
            this.renderTexture.draw(obj, index * 100, 50);
        });
        
        // Render texture operations
        this.renderTexture.clear();                    // Clear contents
        this.renderTexture.fill(0x00ff00);            // Fill with color
        this.renderTexture.stamp('logo', 10, 10);     // Stamp texture
        
        // Save render texture
        this.renderTexture.snapshot((image) => {
            console.log('Render texture saved as image');
            // Could save to server or local storage
        });
        
        // Use render texture on other objects
        const resultSprite = this.add.sprite(600, 400, this.renderTexture.texture);
        
        // Dynamic painting system
        this.setupDynamicPainting();
    }
    
    setupDynamicPainting() {
        // Create painting canvas
        this.paintTexture = this.add.renderTexture(100, 100, 300, 300);
        this.paintTexture.fill(0xffffff); // White background
        
        // Brush settings
        this.brushSize = 5;
        this.brushColor = 0x000000;
        this.isDrawing = false;
        
        // Mouse/touch painting
        this.input.on('pointerdown', (pointer) => {
            if (this.isPointerOverPaintArea(pointer)) {
                this.isDrawing = true;
                this.lastPaintPoint = { x: pointer.x - 100, y: pointer.y - 100 };
            }
        });
        
        this.input.on('pointermove', (pointer) => {
            if (this.isDrawing && this.isPointerOverPaintArea(pointer)) {
                const currentPoint = { x: pointer.x - 100, y: pointer.y - 100 };
                this.paintBrushStroke(this.lastPaintPoint, currentPoint);
                this.lastPaintPoint = currentPoint;
            }
        });
        
        this.input.on('pointerup', () => {
            this.isDrawing = false;
        });
        
        // Brush size controls
        this.input.keyboard.on('keydown-ONE', () => { this.brushSize = 2; });
        this.input.keyboard.on('keydown-TWO', () => { this.brushSize = 5; });
        this.input.keyboard.on('keydown-THREE', () => { this.brushSize = 10; });
        
        // Color controls
        this.input.keyboard.on('keydown-R', () => { this.brushColor = 0xff0000; });
        this.input.keyboard.on('keydown-G', () => { this.brushColor = 0x00ff00; });
        this.input.keyboard.on('keydown-B', () => { this.brushColor = 0x0000ff; });
    }
    
    paintBrushStroke(from, to) {
        // Create brush graphics
        const brush = this.add.graphics();
        brush.fillStyle(this.brushColor);
        
        // Draw line between points
        const distance = Phaser.Math.Distance.Between(from.x, from.y, to.x, to.y);
        const steps = Math.max(1, Math.floor(distance / (this.brushSize / 2)));
        
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = Phaser.Math.Linear(from.x, to.x, t);
            const y = Phaser.Math.Linear(from.y, to.y, t);
            
            brush.fillCircle(x, y, this.brushSize);
        }
        
        // Draw to paint texture
        this.paintTexture.draw(brush, 0, 0);
        brush.destroy();
    }
    
    isPointerOverPaintArea(pointer) {
        return pointer.x >= 100 && pointer.x <= 400 && 
               pointer.y >= 100 && pointer.y <= 400;
    }
}
```

## Blend Modes and Visual Effects

### Blend Modes
Control how objects are composited:

```javascript { .api }
class BlendModeScene extends Phaser.Scene {
    create() {
        // Create base objects
        const background = this.add.rectangle(400, 300, 200, 200, 0x888888);
        
        // Demonstrate different blend modes
        const blendModes = [
            { mode: Phaser.BlendModes.NORMAL, name: 'Normal' },
            { mode: Phaser.BlendModes.ADD, name: 'Add' },
            { mode: Phaser.BlendModes.MULTIPLY, name: 'Multiply' },
            { mode: Phaser.BlendModes.SCREEN, name: 'Screen' },
            { mode: Phaser.BlendModes.OVERLAY, name: 'Overlay' },
            { mode: Phaser.BlendModes.DARKEN, name: 'Darken' },
            { mode: Phaser.BlendModes.LIGHTEN, name: 'Lighten' },
            { mode: Phaser.BlendModes.COLOR_DODGE, name: 'Color Dodge' },
            { mode: Phaser.BlendModes.COLOR_BURN, name: 'Color Burn' },
            { mode: Phaser.BlendModes.HARD_LIGHT, name: 'Hard Light' },
            { mode: Phaser.BlendModes.SOFT_LIGHT, name: 'Soft Light' },
            { mode: Phaser.BlendModes.DIFFERENCE, name: 'Difference' },
            { mode: Phaser.BlendModes.EXCLUSION, name: 'Exclusion' },
            { mode: Phaser.BlendModes.ERASE, name: 'Erase' }
        ];
        
        blendModes.forEach((blend, index) => {
            const x = 100 + (index % 4) * 150;
            const y = 100 + Math.floor(index / 4) * 120;
            
            // Background circle
            this.add.circle(x, y, 40, 0xff0000, 0.8);
            
            // Overlapping circle with blend mode
            const blendedCircle = this.add.circle(x + 25, y + 25, 40, 0x0000ff, 0.8);
            blendedCircle.setBlendMode(blend.mode);
            
            // Label
            this.add.text(x - 30, y + 60, blend.name, {
                fontSize: '10px',
                fill: '#ffffff'
            });
        });
        
        // Interactive blend mode demo
        this.setupInteractiveBlending();
    }
    
    setupInteractiveBlending() {
        // Create interactive objects
        this.baseLayer = this.add.circle(600, 300, 60, 0xff6600);
        this.blendLayer = this.add.circle(650, 330, 60, 0x0066ff);
        
        let currentBlendIndex = 0;
        const blendModesList = Object.values(Phaser.BlendModes).filter(mode => typeof mode === 'number');
        
        this.blendLayer.setBlendMode(blendModesList[currentBlendIndex]);
        
        // Cycle through blend modes on click
        this.blendLayer.setInteractive();
        this.blendLayer.on('pointerdown', () => {
            currentBlendIndex = (currentBlendIndex + 1) % blendModesList.length;
            this.blendLayer.setBlendMode(blendModesList[currentBlendIndex]);
            
            console.log('Blend mode:', Object.keys(Phaser.BlendModes)[currentBlendIndex]);
        });
        
        // Animate blend layer
        this.tweens.add({
            targets: this.blendLayer,
            x: 550,
            duration: 2000,
            yoyo: true,
            repeat: -1
        });
    }
}
```

### Visual Effects and Filters
Apply visual effects to game objects:

```javascript { .api }
class VisualEffectsScene extends Phaser.Scene {
    create() {
        // Tint effects
        const redTintedSprite = this.add.sprite(100, 100, 'logo');
        redTintedSprite.setTint(0xff0000);
        
        // Multiple tints (corners)
        const multiTintSprite = this.add.sprite(200, 100, 'logo');
        multiTintSprite.setTint(0xff0000, 0x00ff00, 0x0000ff, 0xffff00);
        
        // Alpha effects
        const alphaSprite = this.add.sprite(300, 100, 'logo');
        alphaSprite.setAlpha(0.5);
        
        // Scale effects
        const scaledSprite = this.add.sprite(400, 100, 'logo');
        scaledSprite.setScale(2, 0.5);
        
        // Rotation effects
        const rotatedSprite = this.add.sprite(500, 100, 'logo');
        rotatedSprite.setRotation(Math.PI / 4);
        
        // Flip effects
        const flippedSprite = this.add.sprite(600, 100, 'logo');
        flippedSprite.setFlipX(true);
        flippedSprite.setFlipY(true);
        
        // Origin effects
        const originSprite = this.add.sprite(700, 100, 'logo');
        originSprite.setOrigin(0, 0); // Top-left corner
        
        // Mask effects
        this.setupMaskEffects();
        
        // Shader effects (WebGL only)
        if (this.renderer.type === Phaser.WEBGL) {
            this.setupShaderEffects();
        }
        
        // Animation effects
        this.setupAnimationEffects();
    }
    
    setupMaskEffects() {
        // Geometry mask
        const maskShape = this.add.graphics();
        maskShape.fillStyle(0xffffff);
        maskShape.fillCircle(200, 300, 80);
        
        const geometryMask = maskShape.createGeometryMask();
        
        const maskedImage = this.add.image(200, 300, 'logo');
        maskedImage.setMask(geometryMask);
        
        // Bitmap mask
        const maskTexture = this.add.image(400, 300, 'maskTexture');
        const bitmapMask = maskTexture.createBitmapMask();
        
        const bitmapMaskedImage = this.add.image(400, 300, 'logo');
        bitmapMaskedImage.setMask(bitmapMask);
        
        // Animated mask
        this.tweens.add({
            targets: maskShape,
            scaleX: 1.5,
            scaleY: 1.5,
            duration: 2000,
            yoyo: true,
            repeat: -1
        });
    }
    
    setupShaderEffects() {
        // Load and create shader
        this.load.glsl('waveShader', 'assets/shaders/wave.frag');
        
        this.load.once('complete', () => {
            const shader = this.add.shader('waveShader', 600, 300, 200, 200);
            
            // Animate shader uniforms
            shader.setUniform('time.value', 0);
            
            this.tweens.add({
                targets: shader,
                'uniforms.time.value': 10,
                duration: 5000,
                repeat: -1
            });
        });
        
        this.load.start();
    }
    
    setupAnimationEffects() {
        // Pulsing effect
        const pulsingSprite = this.add.sprite(100, 400, 'logo');
        this.tweens.add({
            targets: pulsingSprite,
            scaleX: 1.2,
            scaleY: 1.2,
            duration: 1000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut'
        });
        
        // Glowing effect
        const glowSprite = this.add.sprite(300, 400, 'logo');
        this.tweens.add({
            targets: glowSprite,
            alpha: 0.3,
            duration: 800,
            yoyo: true,
            repeat: -1
        });
        
        // Color cycling effect
        const colorSprite = this.add.sprite(500, 400, 'logo');
        let hue = 0;
        
        this.time.addEvent({
            delay: 50,
            repeat: -1,
            callback: () => {
                hue = (hue + 5) % 360;
                const color = Phaser.Display.Color.HSVToRGB(hue / 360, 1, 1);
                colorSprite.setTint(color.color);
            }
        });
        
        // Particle trail effect
        this.setupParticleTrail();
    }
    
    setupParticleTrail() {
        const trailSprite = this.add.sprite(700, 400, 'logo');
        
        // Create particle emitter for trail
        const particles = this.add.particles(0, 0, 'particle', {
            follow: trailSprite,
            quantity: 2,
            scale: { start: 0.3, end: 0 },
            alpha: { start: 0.8, end: 0 },
            lifespan: 500,
            tint: 0x00ff88
        });
        
        // Move sprite in circle
        this.tweens.add({
            targets: trailSprite,
            x: 700 + Math.cos(0) * 100,
            y: 400 + Math.sin(0) * 100,
            duration: 0
        });
        
        let angle = 0;
        this.time.addEvent({
            delay: 16,
            repeat: -1,
            callback: () => {
                angle += 0.05;
                trailSprite.x = 700 + Math.cos(angle) * 100;
                trailSprite.y = 400 + Math.sin(angle) * 50;
            }
        });
    }
}
```

## Display Utilities

### Alignment and Layout
Position and align objects systematically:

```javascript { .api }
class DisplayUtilitiesScene extends Phaser.Scene {
    create() {
        // Create container for alignment demo
        const container = this.add.rectangle(400, 300, 300, 200, 0x333333, 0.5);
        
        // Create objects to align
        const objects = [];
        for (let i = 0; i < 9; i++) {
            const obj = this.add.circle(0, 0, 15, Phaser.Display.Color.HSVToRGB(i / 9, 1, 1).color);
            objects.push(obj);
        }
        
        // Alignment using Display.Align
        const alignPositions = [
            Phaser.Display.Align.TOP_LEFT,
            Phaser.Display.Align.TOP_CENTER,
            Phaser.Display.Align.TOP_RIGHT,
            Phaser.Display.Align.LEFT_CENTER,
            Phaser.Display.Align.CENTER,
            Phaser.Display.Align.RIGHT_CENTER,
            Phaser.Display.Align.BOTTOM_LEFT,
            Phaser.Display.Align.BOTTOM_CENTER,
            Phaser.Display.Align.BOTTOM_RIGHT
        ];
        
        objects.forEach((obj, index) => {
            Phaser.Display.Align.In.QuickSet(obj, container, alignPositions[index]);
        });
        
        // Grid layout
        this.createGridLayout();
        
        // Bounds utilities
        this.demonstrateBounds();
        
        // Color utilities
        this.demonstrateColors();
    }
    
    createGridLayout() {
        // Create grid of objects
        const gridObjects = [];
        for (let i = 0; i < 20; i++) {
            const obj = this.add.rectangle(0, 0, 30, 30, 0xff6600);
            gridObjects.push(obj);
        }
        
        // Arrange in grid
        Phaser.Actions.GridAlign(gridObjects, {
            width: 5,
            height: 4,
            cellWidth: 40,
            cellHeight: 40,
            x: 50,
            y: 50
        });
        
        // Circular arrangement
        const circleObjects = [];
        for (let i = 0; i < 12; i++) {
            const obj = this.add.circle(0, 0, 8, 0x00ff88);
            circleObjects.push(obj);
        }
        
        const circle = new Phaser.Geom.Circle(600, 200, 80);
        Phaser.Actions.PlaceOnCircle(circleObjects, circle);
        
        // Line arrangement
        const lineObjects = [];
        for (let i = 0; i < 10; i++) {
            const obj = this.add.triangle(0, 0, 0, 10, 10, 10, 5, 0, 0x8800ff);
            lineObjects.push(obj);
        }
        
        const line = new Phaser.Geom.Line(100, 500, 300, 450);
        Phaser.Actions.PlaceOnLine(lineObjects, line);
    }
    
    demonstrateBounds() {
        const sprite = this.add.sprite(500, 500, 'logo');
        sprite.setScale(0.5);
        
        // Get bounds information
        const bounds = sprite.getBounds();
        console.log('Sprite bounds:', bounds);
        
        // Bounds utilities
        const left = Phaser.Display.Bounds.GetLeft(sprite);
        const right = Phaser.Display.Bounds.GetRight(sprite);
        const top = Phaser.Display.Bounds.GetTop(sprite);
        const bottom = Phaser.Display.Bounds.GetBottom(sprite);
        const centerX = Phaser.Display.Bounds.GetCenterX(sprite);
        const centerY = Phaser.Display.Bounds.GetCenterY(sprite);
        
        console.log('Bounds - Left:', left, 'Right:', right, 'Top:', top, 'Bottom:', bottom);
        console.log('Center:', centerX, centerY);
        
        // Set bounds positions
        const boundSprite = this.add.sprite(0, 0, 'logo');
        Phaser.Display.Bounds.SetLeft(boundSprite, 100);
        Phaser.Display.Bounds.SetTop(boundSprite, 100);
        
        // Center object
        Phaser.Display.Bounds.CenterOn(boundSprite, 400, 100);
        
        // Visualize bounds
        const graphics = this.add.graphics();
        graphics.lineStyle(2, 0xff0000);
        graphics.strokeRectShape(bounds);
    }
    
    demonstrateColors() {
        // Color class usage
        const color1 = new Phaser.Display.Color(255, 128, 64);
        const color2 = new Phaser.Display.Color();
        
        // Color operations
        color2.setFromRGB({ r: 128, g: 255, b: 192 });
        
        console.log('Color 1 hex:', color1.color32);
        console.log('Color 2 HSV:', color2.h, color2.s, color2.v);
        
        // Color manipulation
        color1.brighten(20);
        color1.saturate(10);
        color2.desaturate(15);
        
        // Color interpolation
        const interpolated = Phaser.Display.Color.Interpolate.ColorWithColor(
            color1, color2, 10, 5
        );
        
        // Random colors
        const randomColor = Phaser.Display.Color.RandomRGB();
        
        // HSV color wheel
        const colorWheel = Phaser.Display.Color.HSVColorWheel(1, 1);
        
        // Display color examples
        colorWheel.forEach((color, index) => {
            const x = 50 + (index % 16) * 25;
            const y = 550 + Math.floor(index / 16) * 25;
            this.add.circle(x, y, 10, color.color);
        });
    }
}
```

## Performance Optimization

### Rendering Optimization
Techniques for optimal rendering performance:

```javascript { .api }
class RenderingOptimizationScene extends Phaser.Scene {
    create() {
        // Object pooling for frequently created/destroyed objects
        this.bulletPool = this.add.group({
            classType: Phaser.GameObjects.Image,
            key: 'bullet',
            frame: 0,
            active: false,
            visible: false,
            maxSize: 100
        });
        
        // Texture atlasing to reduce draw calls
        this.createAtlasedSprites();
        
        // Culling optimization
        this.setupCulling();
        
        // Batch rendering
        this.setupBatchRendering();
        
        // Level-of-detail (LOD) system
        this.setupLOD();
    }
    
    createAtlasedSprites() {
        // Use texture atlas instead of individual images
        const atlasSprites = [];
        const frames = ['sprite1', 'sprite2', 'sprite3', 'sprite4'];
        
        for (let i = 0; i < 100; i++) {
            const frame = Phaser.Utils.Array.GetRandom(frames);
            const sprite = this.add.sprite(
                Phaser.Math.Between(0, 800),
                Phaser.Math.Between(0, 600),
                'gameAtlas',
                frame
            );
            atlasSprites.push(sprite);
        }
    }
    
    setupCulling() {
        // Manual culling for large number of objects
        this.objects = [];
        
        for (let i = 0; i < 500; i++) {
            const obj = this.add.rectangle(
                Phaser.Math.Between(0, 2000),
                Phaser.Math.Between(0, 2000),
                20, 20,
                Phaser.Math.Between(0x000000, 0xffffff)
            );
            this.objects.push(obj);
        }
        
        // Culling update
        this.cullObjects();
    }
    
    cullObjects() {
        const camera = this.cameras.main;
        const worldView = camera.worldView;
        
        this.objects.forEach(obj => {
            // Check if object is within camera bounds
            const inView = Phaser.Geom.Rectangle.Overlaps(worldView, obj.getBounds());
            obj.setVisible(inView);
            
            // Disable expensive operations for off-screen objects
            if (!inView && obj.body) {
                obj.body.enable = false;
            } else if (inView && obj.body) {
                obj.body.enable = true;
            }
        });
    }
    
    setupBatchRendering() {
        // Use Graphics object for batched drawing
        this.batchGraphics = this.add.graphics();
        
        // Draw many shapes in single batch
        this.batchGraphics.fillStyle(0xff0000);
        for (let i = 0; i < 100; i++) {
            this.batchGraphics.fillCircle(
                Phaser.Math.Between(0, 800),
                Phaser.Math.Between(0, 600),
                Phaser.Math.Between(5, 15)
            );
        }
        
        // Use Blitter for many similar sprites
        this.blitter = this.add.blitter(0, 0, 'particle');
        
        for (let i = 0; i < 200; i++) {
            this.blitter.create(
                Phaser.Math.Between(0, 800),
                Phaser.Math.Between(0, 600)
            );
        }
    }
    
    setupLOD() {
        // Level-of-detail based on distance from camera
        this.lodObjects = [];
        
        for (let i = 0; i < 50; i++) {
            const obj = {
                x: Phaser.Math.Between(0, 2000),
                y: Phaser.Math.Between(0, 2000),
                highDetail: this.add.sprite(0, 0, 'highDetailSprite'),
                mediumDetail: this.add.sprite(0, 0, 'mediumDetailSprite'),
                lowDetail: this.add.sprite(0, 0, 'lowDetailSprite')
            };
            
            obj.highDetail.setPosition(obj.x, obj.y);
            obj.mediumDetail.setPosition(obj.x, obj.y);
            obj.lowDetail.setPosition(obj.x, obj.y);
            
            this.lodObjects.push(obj);
        }
        
        this.updateLOD();
    }
    
    updateLOD() {
        const camera = this.cameras.main;
        const cameraCenter = new Phaser.Math.Vector2(
            camera.scrollX + camera.width / 2,
            camera.scrollY + camera.height / 2
        );
        
        this.lodObjects.forEach(obj => {
            const distance = Phaser.Math.Distance.Between(
                cameraCenter.x, cameraCenter.y, obj.x, obj.y
            );
            
            // Show different detail levels based on distance
            obj.highDetail.setVisible(distance < 200);
            obj.mediumDetail.setVisible(distance >= 200 && distance < 500);
            obj.lowDetail.setVisible(distance >= 500);
        });
    }
    
    update() {
        // Update optimization systems
        this.cullObjects();
        this.updateLOD();
        
        // Performance monitoring
        if (this.time.now % 1000 < 16) { // Once per second
            console.log('FPS:', this.game.loop.actualFps);
            console.log('Visible objects:', this.children.list.filter(child => child.visible).length);
        }
    }
}
```

This comprehensive rendering system provides all the tools needed to create visually stunning games with optimal performance across different devices and rendering contexts.