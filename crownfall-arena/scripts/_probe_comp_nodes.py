import bpy
ng = bpy.data.node_groups.new("t", "CompositorNodeTree")
ok = []
for t in ("ShaderNodeMapRange","ShaderNodeMix","ShaderNodeMath","CompositorNodeMixRGB","CompositorNodeEllipseMask","CompositorNodeBlur","CompositorNodeMapRange","CompositorNodeMath","CompositorNodeMapValue","ShaderNodeValToRGB","CompositorNodeValToRGB","CompositorNodeSepRGBA","CompositorNodeSeparateColor","CompositorNodeColorBalance","CompositorNodeCurveRGB","CompositorNodeLensdist"):
    try:
        n = ng.nodes.new(t); ok.append((t, [i.name for i in n.inputs][:6]))
    except Exception as e:
        ok.append((t, "NO"))
for x in ok: print("NODE", x)
