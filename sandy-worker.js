importScripts('./sandy-image.js', 'https://cdnjs.cloudflare.com/ajax/libs/gl-matrix/2.8.1/gl-matrix-min.js')

const { Image } = wasm_bindgen;

function RenderEngine(terrain, canvas, grains) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {
        antialias: true,
    });

    if (!this.gl) {
        throw new Error('WebGL2 not supported');
    }

    this.terrain = terrain;
    this.grains = grains;

    // 3D camera parameters
    this.zoom = 5.0;
    this.rotationX = 0.5; // rotation around X axis (up/down)
    this.rotationY = 0.0; // rotation around Y axis (left/right)
    this.panX = 0;
    this.panY = 0;
    this.panZ = -140; // Initial camera distance

    // Initialize WebGL context
    this.initShaders();
    this.initBuffers();
    this.initSphereGeometry();
}

RenderEngine.prototype.initSphereGeometry = function () {
    const gl = this.gl;

    // Create a sphere geometry
    const radius = 0.5; // Unit sphere (1 unit diameter)
    const latitudeBands = 4;
    const longitudeBands = 4;

    const positions = [];
    const normals = [];
    const indices = [];

    // Generate vertex positions
    for (let lat = 0; lat <= latitudeBands; lat++) {
        const theta = lat * Math.PI / latitudeBands;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);

        for (let lon = 0; lon <= longitudeBands; lon++) {
            const phi = lon * 2 * Math.PI / longitudeBands;
            const sinPhi = Math.sin(phi);
            const cosPhi = Math.cos(phi);

            const x = cosPhi * sinTheta;
            const y = cosTheta;
            const z = sinPhi * sinTheta;

            // Position
            positions.push(radius * x);
            positions.push(radius * y);
            positions.push(radius * z);

            // Normal
            normals.push(x);
            normals.push(y);
            normals.push(z);
        }
    }

    // Generate indices
    for (let lat = 0; lat < latitudeBands; lat++) {
        for (let lon = 0; lon < longitudeBands; lon++) {
            const first = (lat * (longitudeBands + 1)) + lon;
            const second = first + longitudeBands + 1;

            indices.push(first);
            indices.push(second);
            indices.push(first + 1);

            indices.push(second);
            indices.push(second + 1);
            indices.push(first + 1);
        }
    }

    // Create and bind position buffer
    this.spherePositionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spherePositionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    // Create and bind normal buffer
    this.sphereNormalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sphereNormalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);

    // Create and bind index buffer
    this.sphereIndexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.sphereIndexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);

    this.sphereIndexCount = indices.length;
};

RenderEngine.prototype.initShaders = function () {
    const gl = this.gl;

    // Vertex shader for 3D spheres
    const vsSource = `#version 300 es
    in vec3 aVertexPosition;
    in vec3 aVertexNormal;
    in vec4 aInstanceData;  // x, y, z, speed (using z instead of y for 3D)

    uniform mat4 uModelViewMatrix;
    uniform mat4 uProjectionMatrix;
    uniform mat4 uNormalMatrix;

    out vec3 vNormal;
    out vec3 vLightDirection;
    out float vSpeed;

    void main() {
        // Extract position and velocity from instance data
        vec3 instancePosition = vec3(aInstanceData.x, 0.5, aInstanceData.y); // Place on "floor" (y=0)
        vSpeed = length(vec2(aInstanceData.z, aInstanceData.w)); // Speed from velocity
        
        // Transform the vertex position based on instance position
        vec4 worldPosition = vec4(aVertexPosition + instancePosition, 1.0);
        gl_Position = uProjectionMatrix * uModelViewMatrix * worldPosition;
        
        // Transform the normal for lighting
        vNormal = mat3(uNormalMatrix) * aVertexNormal;
        
        // Simple directional light from above
        vLightDirection = normalize(vec3(0.5, 1.0, 0.5));
    }`;

    // Fragment shader for 3D spheres with lighting
    const fsSource = `#version 300 es
    precision highp float;

    in vec3 vNormal;
    in vec3 vLightDirection;
    in float vSpeed;

    out vec4 fragColor;

    void main() {
        // Normalized normal vector
        vec3 normal = normalize(vNormal);
        
        // Calculate diffuse lighting
        float diffuse = max(dot(normal, vLightDirection), 0.0);
        
        // Ambient lighting
        float ambient = 0.3;
        
        // Calculate lighting factor
        float lightFactor = ambient + diffuse * 0.7;
        
        // Color based on velocity magnitude (blue->green->yellow->red)
        vec3 baseColor = mix(
            vec3(0.0, 0.0, 1.0),  // Slow (blue)
            vec3(1.0, 0.0, 0.0),  // Fast (red)
            clamp(vSpeed * 5.0, 0.0, 1.0)
        );
        
        // Apply lighting to color
        vec3 finalColor = baseColor * lightFactor;
        
        fragColor = vec4(finalColor, 1.0);
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
    this.positionAttrib = gl.getAttribLocation(this.program, 'aVertexPosition');
    this.normalAttrib = gl.getAttribLocation(this.program, 'aVertexNormal');
    this.instanceDataAttrib = gl.getAttribLocation(this.program, 'aInstanceData');

    this.modelViewMatrixUniform = gl.getUniformLocation(this.program, 'uModelViewMatrix');
    this.projectionMatrixUniform = gl.getUniformLocation(this.program, 'uProjectionMatrix');
    this.normalMatrixUniform = gl.getUniformLocation(this.program, 'uNormalMatrix');

    // Set up perspective and view matrices
    this.updateProjectionMatrix();
}

RenderEngine.prototype.updateProjectionMatrix = function () {
    const gl = this.gl;

    // Create perspective matrix
    const fieldOfView = 45 * Math.PI / 180;   // in radians
    const aspect = gl.canvas.width / gl.canvas.height;
    const zNear = 0.1;
    const zFar = 1000.0;

    const projectionMatrix = mat4.create();
    mat4.perspective(projectionMatrix, fieldOfView, aspect, zNear, zFar);

    // Set projection matrix uniform
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.projectionMatrixUniform, false, projectionMatrix);
};

RenderEngine.prototype.updateModelViewMatrix = function () {
    const gl = this.gl;

    // Create model-view matrix
    const modelViewMatrix = mat4.create();

    // Apply camera transformations (in reverse order)
    mat4.translate(modelViewMatrix, modelViewMatrix, [this.panX, this.panY, this.panZ]);
    mat4.rotateX(modelViewMatrix, modelViewMatrix, this.rotationX);
    mat4.rotateY(modelViewMatrix, modelViewMatrix, this.rotationY);

    // Create normal matrix for lighting calculations
    const normalMatrix = mat4.create();
    mat4.invert(normalMatrix, modelViewMatrix);
    mat4.transpose(normalMatrix, normalMatrix);

    // Set uniforms
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.modelViewMatrixUniform, false, modelViewMatrix);
    gl.uniformMatrix4fv(this.normalMatrixUniform, false, normalMatrix);
};

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

    // Create buffer for instance data (grain positions and velocities)
    this.grainBuffer = gl.createBuffer();
}

RenderEngine.prototype.updateGrains = function () {
    const gl = this.gl;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.grainBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.grains, gl.DYNAMIC_DRAW);
}

RenderEngine.prototype.setRotation = function (rotX, rotY) {
    this.rotationX = rotX;
    this.rotationY = rotY;
};

RenderEngine.prototype.setPan = function (x, y, z) {
    if (z !== undefined) this.panZ = z;
    this.panX = x;
    this.panY = y;
};

RenderEngine.prototype.render = function () {
    const gl = this.gl;

    // Update view matrix with current camera parameters
    this.updateModelViewMatrix();

    // Clear canvas
    gl.clearColor(0.9, 0.9, 0.9, 1.0); // Light background to see if clearing works
    gl.clearDepth(1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Use shader program
    gl.useProgram(this.program);

    // Bind sphere geometry buffers
    gl.bindBuffer(gl.ARRAY_BUFFER, this.spherePositionBuffer);
    gl.vertexAttribPointer(this.positionAttrib, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(this.positionAttrib);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.sphereNormalBuffer);
    gl.vertexAttribPointer(this.normalAttrib, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(this.normalAttrib);

    // Bind instance data and set up instanced attribute
    gl.bindBuffer(gl.ARRAY_BUFFER, this.grainBuffer);
    gl.vertexAttribPointer(this.instanceDataAttrib, 4, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(this.instanceDataAttrib);
    gl.vertexAttribDivisor(this.instanceDataAttrib, 1); // This makes it an instanced attribute

    // Bind index buffer
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.sphereIndexBuffer);

    // Draw instanced spheres
    const numInstances = this.grains.length / 4;
    gl.drawElementsInstanced(
        gl.TRIANGLES,
        this.sphereIndexCount,
        gl.UNSIGNED_SHORT,
        0,
        numInstances // Number of instances
    );

    // Cleanup
    gl.vertexAttribDivisor(this.instanceDataAttrib, 0); // Reset the divisor
    gl.disableVertexAttribArray(this.positionAttrib);
    gl.disableVertexAttribArray(this.normalAttrib);
    gl.disableVertexAttribArray(this.instanceDataAttrib);
}

async function init_wasm() {
    await wasm_bindgen('./sandy-image_bg.wasm');

    let image;
    let renderEngine;
    let animationFrameId;
    let animating = true;

    self.postMessage("ready");

    function animate() {
        if (animating) {
            image.next();

            // Update 
            renderEngine.updateGrains();
        }

        // Render the scene
        renderEngine.render();

        animationFrameId = requestAnimationFrame(animate);
    }

    self.onmessage = async event => {
        if (event.data.grains) {
            let terrain = event.data.terrain;
            let canvas = event.data.offscreen_canvas;
            let width = event.data.width;
            let height = event.data.height;

            // Set canvas size to be larger than the image by default
            const scaleFactor = Math.max(5, Math.min(20, 900 / Math.max(width, height)));
            canvas.width = width * scaleFactor;
            canvas.height = height * scaleFactor;

            image = Image.new(terrain, event.data.grains, event.data.dampingFactor, width, height);
            renderEngine = new RenderEngine(terrain, event.data.offscreen_canvas, event.data.grains);

            console.log("Starting animation");
            animate();
        } else if (event.data.action === "stop") {
            animating = false;
        } else if (event.data.action === "start") {
            animating = true;
        } else if (event.data.action === "rotate") {
            if (renderEngine) {
                renderEngine.setRotation(event.data.rotationX, event.data.rotationY);
            }
        } else if (event.data.action === "pan") {
            if (renderEngine) {
                renderEngine.setPan(event.data.panX, event.data.panY, event.data.panZ);
            }
        } else {
            console.log("Unknown message:", event.data);
        }
    };
}

init_wasm();