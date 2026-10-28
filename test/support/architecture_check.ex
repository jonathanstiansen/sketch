defmodule Sketch.ArchitectureCheck do
  @moduledoc """
  Mechanical checks for the rules in `architecture/rules.exs`.

  Every check takes the directory to inspect, so the architecture tests run the
  same code against the application and against deliberately violating fixtures.
  Each check returns a list of violations; an empty list means the rule holds.
  """

  @type violation :: %{rule: String.t(), subject: String.t(), detail: String.t()}
  @type beam_module :: %{
          module: module(),
          source: String.t(),
          behaviours: [module()],
          atoms: MapSet.t(atom()),
          calls: MapSet.t({module(), atom(), arity()})
        }

  @registry_path "architecture/rules.exs"

  @web_forbidden_references [
    {"A02", Sketch.Repo},
    {"A02", Ecto},
    {"A02", Postgrex},
    {"A02", AshPostgres},
    {"A02", Ash.DataLayer},
    {"A03", Ash.Changeset},
    {"A03", Ash.Query},
    {"A03", Ash.ActionInput}
  ]

  @data_access_modules [Sketch.Repo, Ecto.Repo, Ecto.Adapters.SQL, Ecto.Changeset, Postgrex]
  @domain_module Sketch.Canvas

  @process_behaviours [GenServer, :gen_server, :gen_statem, :gen_event, GenStage]
  @process_primitives [Agent, Registry, :pg]

  @pointer_events ~r/\b(?:on)?(?:pointer(?:down|move|up|cancel|over|out|enter|leave)|mouse(?:down|move|up|over|out|enter|leave|wheel)|touch(?:start|move|end|cancel)|(?:Pointer|Mouse|Touch)Event)\b/i
  @fixed_sleeps ~r/waitForTimeout|setTimeout|\bsleep\s*\(/
  @transport_mocks ~r/\.route(?:FromHAR|WebSocket)?\s*\(|from\s+["'](?:msw|@mswjs\/[^"']+|nock|sinon|mock-socket|playwright-msw|jest-mock)["']|\b(?:jest|vi)\.mock\s*\(/
  @mock_packages ~w(msw nock sinon mock-socket playwright-msw jest-mock)
  @suppressions [
    {~r/eslint-(?:disable|enable)/, "ESLint directive"},
    {~r/@ts-(?:ignore|expect-error|nocheck)/, "TypeScript suppression comment"},
    {~r/credo:(?:disable|enable)/, "Credo suppression comment"},
    {~r/@(?:dialyzer)\b/, "Dialyzer attribute"},
    {~r/ignore_(?:warnings)\b/, "Dialyzer ignore option"}
  ]

  @scanned_extensions ~w(.ex .exs .heex .eex .ts .tsx .js .mjs .cjs .json .yml .yaml)
  @skipped_directories ~w(_build deps node_modules .git .elixir_ls cover tmp test-results playwright-report .claude)
  @skipped_paths ~w(priv/static priv/plts)
  @application_fixture_path "test/architecture/fixtures"

  @spec registry(Path.t()) :: keyword()
  def registry(path \\ @registry_path) do
    {registry, _bindings} = Code.eval_file(path)
    registry
  end

  @spec application_beams() :: [beam_module()]
  def application_beams do
    load_beams(Mix.Project.compile_path(), Path.expand("lib"))
  end

  @spec compile_fixtures!(Path.t(), Path.t()) :: [beam_module()]
  def compile_fixtures!(fixture_dir, output_dir) do
    File.mkdir_p!(output_dir)
    files = Path.wildcard(Path.join(fixture_dir, "**/*.ex"))

    {:ok, _modules, _diagnostics} =
      with_debug_info(fn ->
        Kernel.ParallelCompiler.compile_to_path(files, output_dir, return_diagnostics: true)
      end)

    load_beams(output_dir, fixture_dir)
  end

  # mix test compiles with debug_info disabled, and :xref reads call edges from it.
  defp with_debug_info(compile) do
    previous = Code.get_compiler_option(:debug_info)
    Code.put_compiler_option(:debug_info, true)

    try do
      compile.()
    after
      Code.put_compiler_option(:debug_info, previous)
    end
  end

  @spec load_beams(Path.t(), Path.t()) :: [beam_module()]
  def load_beams(ebin_dir, source_root) do
    calls = call_edges(ebin_dir)
    source_root = Path.expand(source_root)

    ebin_dir
    |> Path.join("*.beam")
    |> Path.wildcard()
    |> Enum.map(&read_beam(&1, calls))
    |> Enum.filter(&String.starts_with?(&1.source, source_root <> "/"))
  end

  defp read_beam(path, calls) do
    {:ok, {module, chunks}} =
      :beam_lib.chunks(String.to_charlist(path), [:attributes, :compile_info, :atoms])

    %{
      module: module,
      source: chunks |> Keyword.fetch!(:compile_info) |> Keyword.fetch!(:source) |> to_string(),
      behaviours: chunks |> Keyword.fetch!(:attributes) |> declared_behaviours(),
      atoms: chunks |> Keyword.fetch!(:atoms) |> MapSet.new(fn {_index, atom} -> atom end),
      calls: Map.get(calls, module, MapSet.new())
    }
  end

  defp declared_behaviours(attributes) do
    attributes
    |> Enum.filter(fn {name, _} -> name in [:behaviour, :behavior] end)
    |> Enum.flat_map(fn {_, modules} -> modules end)
  end

  defp call_edges(ebin_dir) do
    {:ok, xref} = :xref.start(xref_mode: :functions)

    try do
      :ok = :xref.set_default(xref, verbose: false, warnings: false)
      {:ok, _modules} = :xref.add_directory(xref, String.to_charlist(ebin_dir))
      {:ok, edges} = :xref.q(xref, ~c"E")

      Enum.group_by(
        edges,
        fn {{caller, _, _}, _callee} -> caller end,
        fn {_caller, callee} -> callee end
      )
      |> Map.new(fn {caller, callees} -> {caller, MapSet.new(callees)} end)
    after
      :xref.stop(xref)
    end
  end

  @spec web_boundary_violations([beam_module()], [module()]) :: [violation()]
  def web_boundary_violations(beams, exceptions \\ []) do
    {web, application} = Enum.split_with(beams, &web_module?(&1.module))

    web_violations =
      for beam <- web, beam.module not in exceptions, violation <- web_violations(beam) do
        violation
      end

    data_access_violations =
      for beam <- application,
          beam.module != Sketch.Repo,
          {callee, function, arity} <- beam.calls,
          within_any?(callee, @data_access_modules) do
        violation("A03", beam.module, "calls #{format_mfa(callee, function, arity)} outside Ash")
      end

    web_violations ++ data_access_violations
  end

  defp web_violations(beam) do
    forbidden_references(beam) ++ forbidden_web_calls(beam)
  end

  defp forbidden_references(beam) do
    for {rule, forbidden} <- @web_forbidden_references,
        atom <- beam.atoms,
        within?(atom, forbidden) do
      violation(rule, beam.module, "references #{inspect(atom)}")
    end
  end

  defp forbidden_web_calls(beam) do
    Enum.flat_map(beam.calls, fn {callee, function, arity} ->
      case web_call_rule(callee) do
        nil -> []
        rule -> [violation(rule, beam.module, "calls #{format_mfa(callee, function, arity)}")]
      end
    end)
  end

  defp web_call_rule(Ash), do: "A03"
  defp web_call_rule(@domain_module), do: nil

  defp web_call_rule(callee) do
    cond do
      within_any?(callee, @data_access_modules) -> "A02"
      application_module?(callee) and not web_module?(callee) -> "A01"
      true -> nil
    end
  end

  @spec process_violations([beam_module()], [module()]) :: [violation()]
  def process_violations(beams, exceptions \\ []) do
    for beam <- beams, beam.module not in exceptions, violation <- process_violations_for(beam) do
      violation
    end
  end

  defp process_violations_for(beam) do
    behaviours =
      for behaviour <- beam.behaviours, behaviour in @process_behaviours do
        violation("A12", beam.module, "implements #{inspect(behaviour)}")
      end

    primitives =
      for primitive <- @process_primitives, MapSet.member?(beam.atoms, primitive) do
        violation("A12", beam.module, "uses #{inspect(primitive)}")
      end

    repository_name =
      if inspect(beam.module) =~ "Repository",
        do: [violation("A12", beam.module, "is named like a repository layer")],
        else: []

    behaviours ++ primitives ++ repository_name
  end

  @spec pointer_event_violations(Path.t(), [String.t()]) :: [violation()]
  def pointer_event_violations(root, allowed_files) do
    root
    |> source_files(~w(assets/js lib), ~w(.ts .tsx .js .mjs .ex .heex))
    |> Enum.reject(&(&1 in allowed_files))
    |> Enum.flat_map(&matching_lines(root, &1, @pointer_events, "A13", "pointer event"))
  end

  @spec e2e_violations(Path.t()) :: [violation()]
  def e2e_violations(root) do
    sources = source_files(root, ~w(e2e), ~w(.ts .tsx .js .mjs .cjs))

    sleeps =
      Enum.flat_map(sources, &matching_lines(root, &1, @fixed_sleeps, "A20", "fixed sleep"))

    mocks =
      Enum.flat_map(sources, &matching_lines(root, &1, @transport_mocks, "A18", "transport mock"))

    sleeps ++ mocks ++ mock_package_violations(root)
  end

  defp mock_package_violations(root) do
    for {name, _version} <- package_dependencies(root, "e2e/package.json", :all),
        name in @mock_packages or String.starts_with?(name, "@mswjs/") do
      violation("A18", "e2e/package.json", "depends on mock library #{name}")
    end
  end

  @spec suppression_violations(Path.t(), [String.t()]) :: [violation()]
  def suppression_violations(root, skipped_paths \\ []) do
    files = source_files(root, ["."], @scanned_extensions, skipped_paths)

    content_violations =
      for path <- files,
          {pattern, description} <- @suppressions,
          violation <- matching_lines(root, path, pattern, "A21", description) do
        violation
      end

    ignore_files =
      for path <- source_files(root, ["."], :any, skipped_paths),
          path |> Path.basename() |> String.contains?("dialyzer_ignore") do
        violation("A21", path, "Dialyzer ignore file")
      end

    content_violations ++ ignore_files
  end

  @spec application_suppression_violations() :: [violation()]
  def application_suppression_violations do
    suppression_violations(File.cwd!(), [@application_fixture_path])
  end

  @spec dependency_violations([tuple()], Path.t(), keyword()) :: [violation()]
  def dependency_violations(mix_deps, root, allowlists) do
    mix_allowed = allowlists |> Keyword.fetch!(:production_mix_deps) |> Enum.map(&elem(&1, 0))
    npm_allowed = allowlists |> Keyword.fetch!(:production_npm_deps) |> Enum.map(&elem(&1, 0))

    npm_actual =
      for file <- ~w(assets/package.json e2e/package.json),
          {name, _version} <- package_dependencies(root, file, :production),
          do: name

    set_difference_violations("mix.exs", production_mix_deps(mix_deps), mix_allowed) ++
      set_difference_violations("package.json", npm_actual, npm_allowed)
  end

  @spec production_mix_deps([tuple()]) :: [atom()]
  def production_mix_deps(mix_deps) do
    for dep <- mix_deps, production_dep?(dep), do: elem(dep, 0)
  end

  defp production_dep?(dep) do
    only = dep |> dep_options() |> Keyword.get(:only)
    only == nil or :prod in List.wrap(only)
  end

  defp dep_options({_name, options}) when is_list(options), do: options
  defp dep_options({_name, _requirement, options}), do: options
  defp dep_options({_name, _requirement}), do: []

  defp set_difference_violations(subject, actual, allowed) do
    unapproved =
      for name <- actual, name not in allowed do
        violation("A15", subject, "production dependency #{name} is not in the allowlist")
      end

    missing =
      for name <- allowed, name not in actual do
        violation(
          "A15",
          subject,
          "allowlisted dependency #{name} is missing; update the allowlist"
        )
      end

    unapproved ++ missing
  end

  defp package_dependencies(root, relative_path, scope) do
    path = Path.join(root, relative_path)

    if File.exists?(path) do
      package = path |> File.read!() |> JSON.decode!()
      sections = if scope == :all, do: ~w(dependencies devDependencies), else: ~w(dependencies)
      Enum.flat_map(sections, &Map.to_list(Map.get(package, &1, %{})))
    else
      []
    end
  end

  defp source_files(root, directories, extensions, skipped_paths \\ []) do
    root = Path.expand(root)
    skipped = @skipped_paths ++ skipped_paths

    directories
    |> Enum.map(&Path.expand(&1, root))
    |> Enum.filter(&File.dir?/1)
    |> Enum.flat_map(&walk(&1, root, skipped))
    |> Enum.filter(&(extensions == :any or Path.extname(&1) in extensions))
    |> Enum.uniq()
  end

  defp walk(directory, root, skipped) do
    directory
    |> File.ls!()
    |> Enum.flat_map(fn name ->
      path = Path.join(directory, name)
      relative = Path.relative_to(path, root)

      cond do
        name in @skipped_directories or relative in skipped -> []
        File.dir?(path) -> walk(path, root, skipped)
        true -> [relative]
      end
    end)
  end

  defp matching_lines(root, relative_path, pattern, rule, description) do
    root
    |> Path.expand()
    |> Path.join(relative_path)
    |> File.read!()
    |> String.split("\n")
    |> Enum.with_index(1)
    |> Enum.filter(fn {line, _number} -> Regex.match?(pattern, line) end)
    |> Enum.map(fn {line, number} ->
      violation(rule, "#{relative_path}:#{number}", "#{description}: #{String.trim(line)}")
    end)
  end

  defp web_module?(module), do: within?(module, SketchWeb)
  defp application_module?(module), do: within?(module, Sketch)

  defp within_any?(module, namespaces), do: Enum.any?(namespaces, &within?(module, &1))

  defp within?(module, namespace) when is_atom(module) do
    name = Atom.to_string(module)
    prefix = Atom.to_string(namespace)
    name == prefix or String.starts_with?(name, prefix <> ".")
  end

  defp format_mfa(module, function, arity), do: "#{inspect(module)}.#{function}/#{arity}"

  defp violation(rule, subject, detail) when is_atom(subject),
    do: violation(rule, inspect(subject), detail)

  defp violation(rule, subject, detail), do: %{rule: rule, subject: subject, detail: detail}

  @spec format_violations([violation()]) :: String.t()
  def format_violations(violations) do
    Enum.map_join(violations, "\n", &"#{&1.rule} #{&1.subject}: #{&1.detail}")
  end
end
