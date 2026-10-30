import re
import sys
import xml.etree.ElementTree as ET

SVG = "{http://www.w3.org/2000/svg}"
HEX = re.compile(r"^#[0-9a-f]{6}$")


def luminance(hex_colour):
    r, g, b = (int(hex_colour[i : i + 2], 16) / 255 for i in (1, 3, 5))
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


for path in sys.argv[1:]:
    root = ET.parse(path).getroot()
    nodes = list(root.iter())
    elements = [n for n in nodes if n.tag == SVG + "g" and "data-element" in n.attrib]
    background = next(n for n in root if n.tag == SVG + "rect")
    paints = {n.attrib[a] for n in nodes for a in ("fill", "stroke") if a in n.attrib}
    print(path.split("/")[-1])
    print("  viewBox:", root.attrib["viewBox"], "| width x height:", root.attrib["width"], "x", root.attrib["height"])
    print("  element groups:", len(elements), "| class attributes:", sum("class" in n.attrib for n in nodes))
    print("  every fill and stroke is #rrggbb or none:", all(HEX.match(p) or p == "none" for p in paints))
    print("  distinct paints:", len(paints), "| markers in defs:", len(root.findall(f"{SVG}defs/{SVG}marker")))
    print("  background fill:", background.attrib["fill"], "| luminance:", round(luminance(background.attrib["fill"]), 2))
    print("  selection handles or outlines:", sum("data-handle" in n.attrib or "data-selection-outline" in n.attrib for n in nodes))
