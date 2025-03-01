#version 330 core

layout (location = 0) in vec2 aPos;
out vec2 vUV;

void main()
{
    // aPos is expected to be in the range [-1..1] for a full-screen quad.
    vUV = 0.5 * (aPos + 1.0); // convert [-1..1] to [0..1]
    gl_Position = vec4(aPos, 0.0, 1.0);
}
