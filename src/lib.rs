use std::u32;

use js_sys::{Float32Array, Uint8Array};
use wasm_bindgen::prelude::wasm_bindgen;

#[wasm_bindgen]
pub struct Image {
    positions: Float32Array,  // x, y, z
    velocities: Float32Array, // vx, vy, vz
    damping_factor: f32,
    width: f32,
    height: f32,
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

        Self {
            positions,
            velocities,
            damping_factor,
            width,
            height,
        }
    }

    pub fn next(&mut self) {
        let grain_count = self.positions.length() / 3;

        for i in 0..grain_count {
            // Get position
            let mut x = self.positions.get_index(i * 3);
            let mut y = self.positions.get_index(i * 3 + 1);
            let mut z = self.positions.get_index(i * 3 + 2);

            // Get velocity
            let mut vx = self.velocities.get_index(i * 3);
            let mut vy = self.velocities.get_index(i * 3 + 1);
            let mut vz = self.velocities.get_index(i * 3 + 2);

            // Apply velocity to position
            x += vx;
            y += vy;
            z += vz;

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
