[
  check_categories: [
    compiled_code: "Compiled code",
    source_scan: "Source files",
    dependencies: "Dependencies"
  ],
  rules: [
    %{id: "A01", check: :compiled_code},
    %{id: "A02", check: :source_scan},
    %{id: "A03", check: :dependencies},
    %{id: "A04", check: :source_scan},
    %{id: "A05", check: :nonsense},
    %{id: "A06"}
  ]
]
