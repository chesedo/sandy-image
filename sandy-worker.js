importScripts('./sandy-image.js', 'https://cdnjs.cloudflare.com/ajax/libs/gl-matrix/2.8.1/gl-matrix-min.js')

const { Image } = wasm_bindgen;


/**
 * Camera class to handle view transformations
 */
function Camera() {
    this.rotationX = 0.5; // rotation around X axis (up/down)
    this.rotationY = 0.0; // rotation around Y axis (left/right)
    this.panX = 0;
    this.panY = 0;
    this.panZ = -140; // Initial camera distance
    this.rotationCenterX = 0;
    this.rotationCenterY = 0;
    this.rotationCenterZ = 0;
}

Camera.prototype.setRotation = function (rotX, rotY) {
    this.rotationX = rotX;
    this.rotationY = rotY;
};

Camera.prototype.setRotationCenter = function (x, y, z) {
    this.rotationCenterX = x;
    this.rotationCenterY = y;
    this.rotationCenterZ = z;
};

Camera.prototype.setPan = function (x, y, z) {
    if (z !== undefined) this.panZ = z;
    this.panX = x;
    this.panY = y;
};

Camera.prototype.updateModelViewMatrix = function (gl, program, modelViewUniform, normalMatrixUniform) {
    // Create model-view matrix
    const modelViewMatrix = mat4.create();

    // Apply camera transformations (in reverse order)
    mat4.translate(modelViewMatrix, modelViewMatrix, [this.panX, this.panY, this.panZ]);

    // Translate to rotation center
    mat4.translate(modelViewMatrix, modelViewMatrix, [this.rotationCenterX, this.rotationCenterY, this.rotationCenterZ]);

    // Apply rotation
    // TODO: use delta rotation based on latest rotation center
    mat4.rotateX(modelViewMatrix, modelViewMatrix, this.rotationX);
    mat4.rotateY(modelViewMatrix, modelViewMatrix, this.rotationY);

    // Translate back from rotation center
    mat4.translate(modelViewMatrix, modelViewMatrix, [-this.rotationCenterX, -this.rotationCenterY, -this.rotationCenterZ]);

    // Create normal matrix for lighting calculations
    const normalMatrix = mat4.create();
    mat4.invert(normalMatrix, modelViewMatrix);
    mat4.transpose(normalMatrix, normalMatrix);

    // Set uniforms
    gl.useProgram(program);
    gl.uniformMatrix4fv(modelViewUniform, false, modelViewMatrix);
    gl.uniformMatrix4fv(normalMatrixUniform, false, normalMatrix);
};


/**
 * Terrain class to handle terrain generation and rendering
 */
function Terrain(gl, terrainData, width, height) {
    this.gl = gl;
    this.terrain = terrainData;
    this.width = width;
    this.height = height;

    this.initGeometry();
    this.initShaders();
    this.wireframeMode = true; // Default to wireframe mode
}

Terrain.prototype.initGeometry = function () {
    const gl = this.gl;
    const width = this.width;
    const height = this.height;

    // Create grid of vertices based on terrain dimensions
    const positions = [];
    const normals = [];
    const indices = [];

    // Generate vertex positions from height map
    for (let z = 0; z < height; z++) {
        for (let x = 0; x < width; x++) {
            // Get height value directly from terrain data
            const heightValue = this.terrain[z * width + x];

            // Use direct pixel-to-unit mapping
            positions.push(x);           // x position
            positions.push(heightValue); // y position (height)
            positions.push(z);           // z position

            // Set initial normal to zero
            normals.push(0);
            normals.push(0);
            normals.push(0);
        }
    }

    // Generate indices for triangles
    for (let z = 0; z < height - 1; z++) {
        for (let x = 0; x < width - 1; x++) {
            const topLeft = z * width + x;
            const topRight = topLeft + 1;
            const bottomLeft = (z + 1) * width + x;
            const bottomRight = bottomLeft + 1;

            // First triangle: topLeft -> bottomLeft -> topRight
            indices.push(topLeft);
            indices.push(bottomLeft);
            indices.push(topRight);

            // Second triangle: topRight -> bottomLeft -> bottomRight
            indices.push(topRight);
            indices.push(bottomLeft);
            indices.push(bottomRight);
        }
    }

    // Calculate normals
    this.calculateNormals(positions, indices, normals);

    // Create and bind position buffer
    this.positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(positions), gl.STATIC_DRAW);

    // Create and bind normal buffer
    this.normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);

    // Create and bind index buffer
    this.indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);

    this.indexCount = indices.length;
};

Terrain.prototype.calculateNormals = function (positions, indices, normals) {
    // Calculate face normals and accumulate at vertices
    for (let i = 0; i < indices.length; i += 3) {
        const idx1 = indices[i] * 3;
        const idx2 = indices[i + 1] * 3;
        const idx3 = indices[i + 2] * 3;

        // Get the three vertices of this face
        const v1 = [positions[idx1], positions[idx1 + 1], positions[idx1 + 2]];
        const v2 = [positions[idx2], positions[idx2 + 1], positions[idx2 + 2]];
        const v3 = [positions[idx3], positions[idx3 + 1], positions[idx3 + 2]];

        // Calculate vectors along two edges of the face
        const edge1 = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
        const edge2 = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]];

        // Calculate cross product to get face normal
        const normal = [
            edge1[1] * edge2[2] - edge1[2] * edge2[1],
            edge1[2] * edge2[0] - edge1[0] * edge2[2],
            edge1[0] * edge2[1] - edge1[1] * edge2[0]
        ];

        // Add this normal to all three vertices
        for (let j = 0; j < 3; j++) {
            normals[idx1 + j] += normal[j];
            normals[idx2 + j] += normal[j];
            normals[idx3 + j] += normal[j];
        }
    }

    // Normalize all vertex normals
    for (let i = 0; i < normals.length; i += 3) {
        const x = normals[i];
        const y = normals[i + 1];
        const z = normals[i + 2];

        const length = Math.sqrt(x * x + y * y + z * z);
        if (length > 0) {
            normals[i] = x / length;
            normals[i + 1] = y / length;
            normals[i + 2] = z / length;
        }
    }
};

Terrain.prototype.initShaders = function () {
    const gl = this.gl;

    // Terrain vertex shader
    const terrainVsSource = `#version 300 es
    in vec3 aVertexPosition;
    in vec3 aVertexNormal;
    
    uniform mat4 uModelViewMatrix;
    uniform mat4 uProjectionMatrix;
    uniform mat4 uNormalMatrix;
    
    out vec3 vNormal;
    out vec3 vPosition;
    
    void main() {
        // Transform vertex position
        vec4 worldPosition = vec4(aVertexPosition, 1.0);
        gl_Position = uProjectionMatrix * uModelViewMatrix * worldPosition;
        
        // Pass normal and position to fragment shader
        vNormal = mat3(uNormalMatrix) * aVertexNormal;
        vPosition = aVertexPosition;
    }`;

    // Terrain fragment shader
    const terrainFsSource = `#version 300 es
    precision highp float;
    
    in vec3 vNormal;
    in vec3 vPosition;
    
    out vec4 fragColor;
    
    void main() {
        // Normalized normal vector
        vec3 normal = normalize(vNormal);
        
        // Directional light from above and slightly to the side
        vec3 lightDirection = normalize(vec3(0.5, 1.0, 0.5));
        
        // Calculate diffuse lighting
        float diffuse = max(dot(normal, lightDirection), 0.0);
        
        // Ambient lighting
        float ambient = 0.3;
        
        // Calculate lighting factor
        float lightFactor = ambient + diffuse * 0.7;
        
        // Height-based coloring (blue at bottom to brown/green at top)
        float height = (vPosition.y + 10.0) / 20.0; // Normalize height to 0-1 range
        
        vec3 baseColor;
        if (height < 0.2) {
            // Deep water (blue)
            baseColor = vec3(0.0, 0.0, 0.5);
        } else if (height < 0.3) {
            // Shallow water (light blue)
            float t = (height - 0.2) / 0.1;
            baseColor = mix(vec3(0.0, 0.0, 0.5), vec3(0.0, 0.2, 0.8), t);
        } else if (height < 0.35) {
            // Sand (tan)
            float t = (height - 0.3) / 0.05;
            baseColor = mix(vec3(0.0, 0.2, 0.8), vec3(0.76, 0.7, 0.5), t);
        } else if (height < 0.6) {
            // Grass/land (green)
            float t = (height - 0.35) / 0.25;
            baseColor = mix(vec3(0.76, 0.7, 0.5), vec3(0.0, 0.5, 0.0), t);
        } else if (height < 0.75) {
            // Mountain (brown)
            float t = (height - 0.6) / 0.15;
            baseColor = mix(vec3(0.0, 0.5, 0.0), vec3(0.5, 0.35, 0.05), t);
        } else {
            // Snow cap (white)
            float t = (height - 0.75) / 0.25;
            baseColor = mix(vec3(0.5, 0.35, 0.05), vec3(1.0, 1.0, 1.0), t);
        }
        
        // Apply lighting to color
        vec3 finalColor = baseColor * lightFactor;
        
        fragColor = vec4(finalColor, 1.0);
    }`;

    // Compile shaders and create program
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, terrainVsSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, terrainFsSource);

    this.program = gl.createProgram();
    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
        throw new Error('Unable to initialize terrain shader program: ' +
            gl.getProgramInfoLog(this.program));
    }

    // Store attribute and uniform locations
    this.positionAttrib = gl.getAttribLocation(this.program, 'aVertexPosition');
    this.normalAttrib = gl.getAttribLocation(this.program, 'aVertexNormal');

    this.modelViewMatrixUniform = gl.getUniformLocation(this.program, 'uModelViewMatrix');
    this.projectionMatrixUniform = gl.getUniformLocation(this.program, 'uProjectionMatrix');
    this.normalMatrixUniform = gl.getUniformLocation(this.program, 'uNormalMatrix');
};

Terrain.prototype.toggleWireframe = function () {
    this.wireframeMode = !this.wireframeMode;
};

Terrain.prototype.render = function (camera, projectionMatrix) {
    const gl = this.gl;

    // Use terrain shader program
    gl.useProgram(this.program);

    // Set projection matrix
    gl.uniformMatrix4fv(this.projectionMatrixUniform, false, projectionMatrix);

    // Update model-view matrix from camera
    camera.updateModelViewMatrix(gl, this.program, this.modelViewMatrixUniform, this.normalMatrixUniform);

    // Bind terrain geometry buffers
    gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
    gl.vertexAttribPointer(this.positionAttrib, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(this.positionAttrib);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
    gl.vertexAttribPointer(this.normalAttrib, 3, gl.FLOAT, false, 0, 0);
    gl.enableVertexAttribArray(this.normalAttrib);

    // Bind index buffer
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);

    // Draw terrain using lines (wireframe) or triangles based on mode
    gl.drawElements(
        this.wireframeMode ? gl.LINES : gl.TRIANGLES,
        this.indexCount,
        gl.UNSIGNED_INT,
        0
    );

    // Cleanup
    gl.disableVertexAttribArray(this.positionAttrib);
    gl.disableVertexAttribArray(this.normalAttrib);
};

/**
 * ParticleSystem class to handle grain particles
 */
function ParticleSystem(gl, grainData) {
    this.gl = gl;
    this.grains = grainData;

    this.initSphereGeometry();
    this.initShaders();
    this.initBuffers();
}

ParticleSystem.prototype.initSphereGeometry = function () {
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

ParticleSystem.prototype.initShaders = function () {
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
    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);

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
};

ParticleSystem.prototype.initBuffers = function () {
    const gl = this.gl;

    // Create buffer for instance data (grain positions and velocities)
    this.grainBuffer = gl.createBuffer();
};

ParticleSystem.prototype.updateGrains = function () {
    const gl = this.gl;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.grainBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.grains, gl.DYNAMIC_DRAW);
};

ParticleSystem.prototype.render = function (camera, projectionMatrix) {
    const gl = this.gl;

    // Use particle shader program
    gl.useProgram(this.program);

    // Set projection matrix
    gl.uniformMatrix4fv(this.projectionMatrixUniform, false, projectionMatrix);

    // Update model-view matrix from camera
    camera.updateModelViewMatrix(gl, this.program, this.modelViewMatrixUniform, this.normalMatrixUniform);

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
};

/**
 * RenderEngine class to manage the overall rendering
 */
function RenderEngine(terrain, canvas, grains, width, height) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {
        antialias: true,
    });

    if (!this.gl) {
        throw new Error('WebGL2 not supported');
    }

    // Initialize components
    this.camera = new Camera();
    this.terrain = new Terrain(this.gl, terrain, width, height);
    this.particles = new ParticleSystem(this.gl, grains);

    // Set up the projection matrix
    this.projectionMatrix = mat4.create();
    this.updateProjectionMatrix();
}

RenderEngine.prototype.updateProjectionMatrix = function () {
    const gl = this.gl;

    // Create perspective matrix
    const fieldOfView = 45 * Math.PI / 180;   // in radians
    const aspect = gl.canvas.width / gl.canvas.height;
    const zNear = 0.1;
    const zFar = 1000.0;

    mat4.perspective(this.projectionMatrix, fieldOfView, aspect, zNear, zFar);
};

RenderEngine.prototype.setRotation = function (rotX, rotY) {
    this.camera.setRotation(rotX, rotY);
};

RenderEngine.prototype.setRotationCenter = function (x, y, z) {
    this.camera.setRotationCenter(x, y, z);
};

RenderEngine.prototype.setPan = function (x, y, z) {
    this.camera.setPan(x, y, z);
};

RenderEngine.prototype.toggleWireframe = function () {
    this.terrain.toggleWireframe();
};

RenderEngine.prototype.updateGrains = function () {
    this.particles.updateGrains();
};

RenderEngine.prototype.render = function () {
    const gl = this.gl;

    // Clear canvas
    gl.clearColor(0.7, 0.8, 0.9, 1.0); // Sky blue background
    gl.clearDepth(1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Render particles
    this.particles.render(this.camera, this.projectionMatrix);

    // Render terrain
    this.terrain.render(this.camera, this.projectionMatrix);
};

/**
 * Helper function to compile a shader
 */
function compileShader(gl, type, source) {
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
            let steps = event.data.steps;
            let grains = event.data.grains;
            let canvas = event.data.offscreen_canvas;
            let width = event.data.width;
            let height = event.data.height;

            // Set canvas size to be larger than the image by default
            const scaleFactor = Math.max(5, Math.min(20, 900 / Math.max(width, height)));
            canvas.width = width * scaleFactor;
            canvas.height = height * scaleFactor;

            // Make terrain grayscale
            let grayscale = new Uint8Array(terrain.length / 4);
            for (let i = 0; i < terrain.length; i += 4) {
                grayscale[i / 4] = (terrain[i] + terrain[i + 1] + terrain[i + 2]) / 3;
            }

            image = Image.new(grayscale, steps, grains, event.data.dampingFactor, width, height);
            renderEngine = new RenderEngine(grayscale, event.data.offscreen_canvas, grains, width, height);

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
        } else if (event.data.action === "setRotationCenter") {
            if (renderEngine) {
                renderEngine.setRotationCenter(
                    event.data.centerX,
                    event.data.centerY,
                    event.data.centerZ
                );
            }
        } else if (event.data.action === "toggleWireframe") {
            if (renderEngine) {
                renderEngine.toggleWireframe();
            }
        } else {
            console.log("Unknown message:", event.data);
        }
    };
}

init_wasm();