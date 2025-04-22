use std::{collections::HashMap, u32};

use js_sys::{Float32Array, Uint8Array};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
pub struct Image {
    terrain: Uint8Array,
    terrain_normals: Vec<[f32; 3]>,
    positions: Float32Array,  // x, y, z
    velocities: Float32Array, // vx, vy, vz
    damping_factor: f32,
    width: f32,
    height: f32,
    grid: HashMap<(i32, i32, i32), Vec<u32>>, // Maps grid cell to list of grain indices
    cell_size: f32,                           // Size of each grid cell
}

#[wasm_bindgen]
impl Image {
    /// Create a new image for the elevation data, initial grains, and other parameters
    pub fn new(
        terrain: Uint8Array,
        steps: u8,
        positions: Float32Array,
        velocities: Float32Array,
        damping_factor: f32,
        width: f32,
        height: f32,
    ) -> Self {
        // Normalize the terrain
        let mut max = u8::MAX;
        let mut min = u8::MIN;

        for i in 0..terrain.length() {
            let value = terrain.get_index(i);
            if value > max {
                max = value;
            }
            if value < min {
                min = value;
            }
        }

        let step_size = (max - min) / steps;

        for i in 0..terrain.length() {
            let value = terrain.get_index(i);
            let mut normalized = (value - min) / step_size;
            if normalized > steps {
                normalized = steps;
            }
            terrain.set_index(i, normalized);
        }

        // Pre-calculate normals for the entire terrain
        let width_i = width as u32;
        let height_i = height as u32;
        let mut terrain_normals = vec![[0.0, 1.0, 0.0]; width_i as usize * height_i as usize];

        // Calculate normals for each point
        for z in 0..height_i {
            for x in 0..width_i {
                let index = z * width_i + x;

                // Sample neighboring heights (with bounds checking)
                let x_left = if x > 0 { x - 1 } else { x };
                let x_right = if x < width_i - 1 { x + 1 } else { x };
                let z_down = if z > 0 { z - 1 } else { z };
                let z_up = if z < height_i - 1 { z + 1 } else { z };

                let h_left = terrain.get_index(z * width_i + x_left) as f32;
                let h_right = terrain.get_index(z * width_i + x_right) as f32;
                let h_down = terrain.get_index(z_down * width_i + x) as f32;
                let h_up = terrain.get_index(z_up * width_i + x) as f32;

                // Calculate gradients
                let dx = (h_right - h_left) / ((x_right - x_left) as f32);
                let dz = (h_up - h_down) / ((z_up - z_down) as f32);

                // Calculate normal
                let normal = [
                    -dx, // x component
                    1.0, // y component
                    -dz, // z component
                ];

                // Normalize
                let length =
                    (normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]).sqrt();
                if length > 0.0 {
                    terrain_normals[index as usize] =
                        [normal[0] / length, normal[1] / length, normal[2] / length];
                }
            }
        }

        Self {
            terrain,
            terrain_normals,
            positions,
            velocities,
            damping_factor,
            width,
            height,
            grid: Default::default(),
            cell_size: 1.0, // Assuming each grid cell is 1x1
        }
    }

    fn get_terrain_height(&self, x: f32, z: f32) -> f32 {
        // Convert world coordinates to terrain grid coordinates
        let grid_x = (x.clamp(0.0, self.width - 1.0)).floor() as u32;
        let grid_z = (z.clamp(0.0, self.height - 1.0)).floor() as u32;

        // Get the terrain height at this position
        let index = grid_z * self.width as u32 + grid_x;
        let terrain_height = self.terrain.get_index(index) as f32;

        terrain_height
    }

    fn get_terrain_normal(&self, x: f32, z: f32) -> [f32; 3] {
        // Clamp coordinates to terrain bounds
        let x_clamped = x.clamp(0.0, self.width - 1.001);
        let z_clamped = z.clamp(0.0, self.height - 1.001);

        // Get integer and fractional parts for interpolation
        let x0 = x_clamped.floor() as usize;
        let z0 = z_clamped.floor() as usize;
        let x1 = (x0 + 1).min(self.width as usize - 1);
        let z1 = (z0 + 1).min(self.height as usize - 1);

        let fx = x_clamped - x0 as f32;
        let fz = z_clamped - z0 as f32;

        // Get normals at the four surrounding grid points
        let width_i = self.width as usize;
        let n00 = self.terrain_normals[z0 * width_i + x0];
        let n10 = self.terrain_normals[z0 * width_i + x1];
        let n01 = self.terrain_normals[z1 * width_i + x0];
        let n11 = self.terrain_normals[z1 * width_i + x1];

        // Bilinear interpolation
        let n0 = [
            (1.0 - fx) * n00[0] + fx * n10[0],
            (1.0 - fx) * n00[1] + fx * n10[1],
            (1.0 - fx) * n00[2] + fx * n10[2],
        ];

        let n1 = [
            (1.0 - fx) * n01[0] + fx * n11[0],
            (1.0 - fx) * n01[1] + fx * n11[1],
            (1.0 - fx) * n01[2] + fx * n11[2],
        ];

        let normal = [
            (1.0 - fz) * n0[0] + fz * n1[0],
            (1.0 - fz) * n0[1] + fz * n1[1],
            (1.0 - fz) * n0[2] + fz * n1[2],
        ];

        // Re-normalize (interpolation might result in non-unit vector)
        let length = (normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]).sqrt();
        if length > 0.0 {
            [normal[0] / length, normal[1] / length, normal[2] / length]
        } else {
            [0.0, 1.0, 0.0] // Fallback
        }
    }

    fn update_spatial_grid(&mut self) {
        self.grid.clear();

        for i in 0..self.positions.length() / 3 {
            let x = self.positions.get_index(i * 3);
            let y = self.positions.get_index(i * 3 + 1);
            let z = self.positions.get_index(i * 3 + 2);

            // Compute grid cell (using integer division)
            let cell_x = (x / self.cell_size).floor() as i32;
            let cell_y = (y / self.cell_size).floor() as i32;
            let cell_z = (z / self.cell_size).floor() as i32;

            // Add particle index to this cell
            self.grid
                .entry((cell_x, cell_y, cell_z))
                .or_insert_with(Vec::new)
                .push(i);
        }
    }

    fn check_collisions(&self) {
        for i in 0..self.positions.length() / 3 {
            let x = self.positions.get_index(i * 3);
            let y = self.positions.get_index(i * 3 + 1);
            let z = self.positions.get_index(i * 3 + 2);

            // Compute grid cell
            let cell_x = (x / self.cell_size).floor() as i32;
            let cell_y = (y / self.cell_size).floor() as i32;
            let cell_z = (z / self.cell_size).floor() as i32;

            // Check collision with particles in same and neighboring cells
            for dx in -1..=1 {
                for dy in -1..=1 {
                    for dz in -1..=1 {
                        if let Some(particles) =
                            self.grid.get(&(cell_x + dx, cell_y + dy, cell_z + dz))
                        {
                            for &j in particles {
                                if i != j {
                                    // Don't collide with self
                                    // Check collision and respond
                                    self.check_and_resolve_collision(i, j);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    fn check_and_resolve_collision(&self, i: u32, j: u32) {
        // Get positions
        let x1 = self.positions.get_index(i * 3);
        let y1 = self.positions.get_index(i * 3 + 1);
        let z1 = self.positions.get_index(i * 3 + 2);

        let x2 = self.positions.get_index(j * 3);
        let y2 = self.positions.get_index(j * 3 + 1);
        let z2 = self.positions.get_index(j * 3 + 2);

        // Calculate distance squared (avoid square root for performance)
        let dx = x2 - x1;
        let dy = y2 - y1;
        let dz = z2 - z1;
        let distance_squared = dx * dx + dy * dy + dz * dz;

        // Assuming particle radius is 0.5 (diameter 1.0)
        let min_distance = 1.0; // Sum of radii

        if distance_squared < min_distance * min_distance {
            // Collision detected!

            // Calculate actual distance (now we need the square root)
            let distance = distance_squared.sqrt();

            // Normalize the collision vector
            let nx = dx / distance;
            let ny = dy / distance;
            let nz = dz / distance;

            // Calculate overlap
            let overlap = min_distance - distance;

            // Resolve position overlap (push particles apart)
            let push_factor = overlap * 0.5; // Each particle moves half the overlap

            // Update positions to prevent overlap
            self.positions.set_index(i * 3, x1 - nx * push_factor);
            self.positions.set_index(i * 3 + 1, y1 - ny * push_factor);
            self.positions.set_index(i * 3 + 2, z1 - nz * push_factor);

            self.positions.set_index(j * 3, x2 + nx * push_factor);
            self.positions.set_index(j * 3 + 1, y2 + ny * push_factor);
            self.positions.set_index(j * 3 + 2, z2 + nz * push_factor);

            // Now handle velocity changes (elastic collision)
            // Get velocities
            let vx1 = self.velocities.get_index(i * 3);
            let vy1 = self.velocities.get_index(i * 3 + 1);
            let vz1 = self.velocities.get_index(i * 3 + 2);

            let vx2 = self.velocities.get_index(j * 3);
            let vy2 = self.velocities.get_index(j * 3 + 1);
            let vz2 = self.velocities.get_index(j * 3 + 2);

            // Calculate relative velocity
            let dvx = vx2 - vx1;
            let dvy = vy2 - vy1;
            let dvz = vz2 - vz1;

            // Calculate relative velocity along the normal
            let normal_velocity = dvx * nx + dvy * ny + dvz * nz;

            // If particles are moving away from each other, skip response
            if normal_velocity > 0.0 {
                return;
            }

            // Calculate impulse (assuming equal masses)
            let restitution = 0.8; // Coefficient of restitution (1.0 = perfectly elastic)
            let impulse = -(1.0 + restitution) * normal_velocity / 2.0;

            // Apply impulse
            self.velocities.set_index(i * 3, vx1 - impulse * nx);
            self.velocities.set_index(i * 3 + 1, vy1 - impulse * ny);
            self.velocities.set_index(i * 3 + 2, vz1 - impulse * nz);

            self.velocities.set_index(j * 3, vx2 + impulse * nx);
            self.velocities.set_index(j * 3 + 1, vy2 + impulse * ny);
            self.velocities.set_index(j * 3 + 2, vz2 + impulse * nz);
        }
    }

    pub fn next(&mut self) {
        let grain_count = self.positions.length() / 3;

        self.update_spatial_grid();

        let gravity = -0.05;

        for i in 0..grain_count {
            // Get position
            let mut x = self.positions.get_index(i * 3);
            let mut y = self.positions.get_index(i * 3 + 1);
            let mut z = self.positions.get_index(i * 3 + 2);

            // Get velocity
            let mut vx = self.velocities.get_index(i * 3);
            let mut vy = self.velocities.get_index(i * 3 + 1);
            let mut vz = self.velocities.get_index(i * 3 + 2);

            // Apply gravity to y-velocity
            vy += gravity;

            // Apply velocity to position
            x += vx;
            y += vy;
            z += vz;

            // Get terrain height at the grain's x,z position
            let terrain_y = self.get_terrain_height(x, z);

            // Check for collision with terrain
            if y < terrain_y {
                // Position correction: place on surface
                y = terrain_y;

                // Calculate actual terrain normal at collision point
                let normal = self.get_terrain_normal(x, z);

                // Calculate reflection vector for velocity
                // v' = v - 2(v·n)n
                let dot_product = vx * normal[0] + vy * normal[1] + vz * normal[2];
                vx = vx - 2.0 * dot_product * normal[0];
                vy = vy - 2.0 * dot_product * normal[1];
                vz = vz - 2.0 * dot_product * normal[2];

                // Add friction/damping on collision
                let restitution = 0.6; // Energy lost in collision
                vx *= restitution;
                vy *= restitution;
                vz *= restitution;
            }

            // Update position
            self.positions.set_index(i * 3, x);
            self.positions.set_index(i * 3 + 1, y);
            self.positions.set_index(i * 3 + 2, z);

            // Update velocity
            self.velocities.set_index(i * 3, vx);
            self.velocities.set_index(i * 3 + 1, vy);
            self.velocities.set_index(i * 3 + 2, vz);
        }

        self.check_collisions();

        for i in 0..grain_count {
            // Get position
            let mut x = self.positions.get_index(i * 3);
            let mut y = self.positions.get_index(i * 3 + 1);
            let mut z = self.positions.get_index(i * 3 + 2);

            // Get velocity
            let mut vx = self.velocities.get_index(i * 3);
            let mut vy = self.velocities.get_index(i * 3 + 1);
            let mut vz = self.velocities.get_index(i * 3 + 2);

            // Boundary checks for x
            if x < 0.0 {
                x *= -1.0;
                vx *= -1.0;
            } else if x > self.width {
                x = self.width - (x - self.width);
                vx *= -1.0;
            }

            // Boundary checks for y (vertical)
            if y < 0.0 {
                y *= -1.0;
                vy *= -1.0;
            }

            // Boundary checks for z
            if z < 0.0 {
                z *= -1.0;
                vz *= -1.0;
            } else if z > self.height {
                z = self.height - (z - self.height);
                vz *= -1.0;
            }

            // Apply damping to velocities
            vx *= self.damping_factor;
            vy *= self.damping_factor;
            vz *= self.damping_factor;

            // Update position
            self.positions.set_index(i * 3, x);
            self.positions.set_index(i * 3 + 1, y);
            self.positions.set_index(i * 3 + 2, z);

            // Update velocity
            self.velocities.set_index(i * 3, vx);
            self.velocities.set_index(i * 3 + 1, vy);
            self.velocities.set_index(i * 3 + 2, vz);
        }
    }
}
