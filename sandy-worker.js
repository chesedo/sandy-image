importScripts('./sandy-image.js')

const { Image } = wasm_bindgen;
function RenderEngine(canvas, size) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2');

    if (!this.gl) {
        throw new Error('WebGL2 not supported');
    }

    this.size = size;

    // Initialize WebGL context
    this.initShaders();
    this.initBuffers();
}

RenderEngine.prototype.initShaders = function () {
    const gl = this.gl;

    // Vertex shader for point sprites
    const vsSource = `#version 300 es
    in vec4 aGrainData;  // x, y, vx, vy

    uniform vec2 uCanvasSize;  // width, height of canvas
    uniform float uSize;

    // Pass velocity to fragment shader if needed
    out vec2 vVelocity;
    out float vSpeed;

    void main() {
        // Extract position and velocity
        vec2 position = aGrainData.xy;
        vec2 velocity = aGrainData.zw;
        
        // Normalize position (0 to 1) and then to clip space (-1 to 1)
        vec2 normalizedPos = position / uCanvasSize;
        gl_Position = vec4(normalizedPos * 2.0 - 1.0, 0.0, 1.0);
        
        gl_PointSize = uSize;
        
        // Pass velocity to fragment shader
        vVelocity = velocity;
        vSpeed = length(velocity);
    }`;

    // Fragment shader for point sprites
    const fsSource = `#version 300 es
    precision mediump float;

    in vec2 vVelocity;
    in float vSpeed;

    out vec4 fragColor;

    void main() {
        // Create circle shape
        vec2 center = gl_PointCoord - vec2(0.5);
        float dist = length(center);
        
        // Soft circle edge
        float alpha = 1.0 - smoothstep(0.45, 0.5, dist);
        
        // Color based on velocity magnitude (blue->green->yellow->red)
        vec3 color = mix(
            vec3(0.0, 0.0, 1.0),  // Slow (blue)
            vec3(1.0, 0.0, 0.0),  // Fast (red)
            clamp(vSpeed * 5.0, 0.0, 1.0)
        );
        
        fragColor = vec4(color, alpha * 0.9);
    }`;

    // Create shaders
    const vertexShader = this.compileShader(gl.VERTEX_SHADER, vsSource);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fsSource);

    // Create program
    this.program = gl.createProgram();
    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
        throw new Error('Unable to initialize shader program: ' +
            gl.getProgramInfoLog(this.program));
    }

    // Store attribute and uniform locations
    this.positionAttrib = gl.getAttribLocation(this.program, 'aGrainData');
    this.sizeUniform = gl.getUniformLocation(this.program, 'uSize');
    this.canvasSizeUniform = gl.getUniformLocation(this.program, 'uCanvasSize');

    // Set the uniforms which never change immediately
    gl.useProgram(this.program);
    gl.uniform1f(this.sizeUniform, this.size);
    gl.uniform2f(this.canvasSizeUniform, this.canvas.width, this.canvas.height);
}

RenderEngine.prototype.compileShader = function (type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const info = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error('Shader compilation failed: ' + info);
    }

    return shader;
}

RenderEngine.prototype.initBuffers = function () {
    const gl = this.gl;

    // Create buffer for grain data
    this.grainBuffer = gl.createBuffer();

    // Create VAO
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.grainBuffer);

    // Single attribute for all grain data (x, y, vx, vy)
    this.grainDataAttrib = gl.getAttribLocation(this.program, 'aGrainData');
    gl.enableVertexAttribArray(this.grainDataAttrib);
    gl.vertexAttribPointer(this.grainDataAttrib, 4, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
}

RenderEngine.prototype.updateGrains = function (grainsData) {
    const gl = this.gl;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.grainBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, grainsData, gl.DYNAMIC_DRAW);
}

RenderEngine.prototype.render = function (count) {
    const gl = this.gl;

    // Clear canvas
    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Use shader program
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);

    // Enable point sprites
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Draw points
    gl.drawArrays(gl.POINTS, 0, count);

    // Cleanup
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
}

async function init_wasm() {
    await wasm_bindgen('./sandy-image_bg.wasm');

    let image;
    let renderEngine;
    let animationFrameId;

    self.postMessage("ready");

    function animate() {
        image.next();
        const grains = image.grains();

        // Update and render
        renderEngine.updateGrains(grains);
        renderEngine.render(grains.length / 4);

        animationFrameId = requestAnimationFrame(animate);
    }

    self.onmessage = async event => {
        if (event.data.grains) {
            let canvas = event.data.offscreen_canvas;
            image = Image.new(event.data.grains, event.data.dampingFactor, canvas.width, canvas.height);

            renderEngine = new RenderEngine(canvas, event.data.size);

            console.log("Done loading image");

            animate();
        } else if (event.data.action === "stop") {
            cancelAnimationFrame(animationFrameId);
        } else if (event.data.action === "start") {
            animate();
        }
    };
}

init_wasm();