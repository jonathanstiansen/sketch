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
  @direct_contexts ~r/\.\s*newContext\s*\(|\b\w*[bB]rowser\s*\.\s*newPage\s*\(/
  @suppressions [
    {~r/eslint-(?:disable|enable)/, "ESLint directive"},
    {~r/@ts-(?:ignore|expect-error|nocheck)/, "TypeScript suppression comment"},
    {~r/credo:(?:disable|enable)/, "Credo suppression comment"},
    {~r/@(?:dialyzer)\b/, "Dialyzer attribute"},
    {~r/ignore_(?:warnings)\b/, "Dialyzer ignore option"}
  ]

  @literal_chord_checks ~r/\b\w*(?:[kK]ey|[cC]ode)\w*\b(?:\.\w+\(\))?\s*(?:===|!==|==|!=)\s*["'`]|["'`]\s*(?:===|!==|==|!=)\s*[\w.]*\b\w*(?:[kK]ey|[cC]ode)\b|\bswitch\s*\(\s*[\w.]*\b(?:key|code)\s*\)|\]\s*\.includes\(\s*[\w.]*\b(?:key|code)\b|phx-(?:window-)?key(?:down|up)?=|aria-keyshortcuts=["']/
  @script_extensions ~w(.sh .bash .mjs .cjs .js .ts)
  @script_directories ~w(docs/evidence e2e scripts)
  @kill_command ~r/(?<![\w.$\/-])kill(?=$|[\s;|&)'"`])((?:\s+-[\w-]+)*)((?:\s+"[^"]*"|\s+[^\s;|&)'"`]+)*)/
  @pid_reference ~r/^["']?(?:\$\{?[A-Za-z_]\w*\}?|\$!|%\d+)["']?;?$/

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

  @doc """
  Lines in `lib/` and `assets/js/` that branch on a literal element kind (A22): `kind == :x` or
  `kind === "x"` in either order and their negations, `kind in [`, `kind: :x`, `data-kind="x"` and
  any `dataset.kind` comparison. Files equal to or under an `allowed_paths` entry are skipped.
  """
  @spec kind_branching_violations(Path.t(), [String.t()], [String.t()]) :: [violation()]
  def kind_branching_violations(root, kinds, allowed_paths) do
    pattern = kind_branching_pattern(kinds)

    root
    |> source_files(~w(lib assets/js), ~w(.ex .exs .heex .ts .tsx .js .mjs))
    |> Enum.reject(&allowed_path?(&1, allowed_paths))
    |> Enum.flat_map(&matching_lines(root, &1, pattern, "A22", "kind branch"))
  end

  defp kind_branching_pattern(kinds) do
    names = Enum.map_join(kinds, "|", &Regex.escape/1)
    literal = ~s/(?::|["'])(?:#{names})\\b/
    comparison = "(?:===|!==|==|!=)"

    [
      "\\bkind\\s*#{comparison}\\s*#{literal}",
      ~s/#{literal}["']?\\s*#{comparison}\\s*[\\w.@]*\\bkind\\b/,
      "\\bkind\\s+(?:not\\s+)?in\\s+\\[",
      "\\bkind:\\s*:(?:#{names})\\b",
      ~s/data-kind=\\\\?["'](?:#{names})\\b/,
      "\\bdataset\\.kind\\s*#{comparison}"
    ]
    |> Enum.join("|")
    |> Regex.compile!()
  end

  defp allowed_path?(file, allowed_paths),
    do: Enum.any?(allowed_paths, &(file == &1 or String.starts_with?(file, &1)))

  @doc """
  Lines in `lib/` and `assets/js/` that check a keyboard key outside `SketchWeb.Shortcuts` (A23):
  a `key`, `code` or `*Key*`/`*Code*` value compared with a string literal in either order, a
  `switch` on `key` or `code`, a literal array's `.includes(…key)`, a `phx-key`/`phx-keydown`/
  `phx-window-keydown` binding or a literal `aria-keyshortcuts` attribute. Files equal to or under an
  `allowed_paths` entry are skipped.
  """
  @spec literal_chord_violations(Path.t(), [String.t()]) :: [violation()]
  def literal_chord_violations(root, allowed_paths) do
    root
    |> source_files(~w(lib assets/js), ~w(.ex .exs .heex .ts .tsx .js .mjs))
    |> Enum.reject(&allowed_path?(&1, allowed_paths))
    |> Enum.flat_map(&matching_lines(root, &1, @literal_chord_checks, "A23", "literal key check"))
  end

  @doc """
  Scripts under `docs/evidence/`, `e2e/` and `scripts/` and the exec blocks of every `DEMO.md`
  under `docs/` that stop processes they did not start: any `pkill` or `killall`, and any `kill`
  whose target is not a PID variable (`kill "$pid"`, `kill -9 $server`, `kill $!`, `kill %1`).
  """
  @spec process_kill_violations(Path.t()) :: [violation()]
  def process_kill_violations(root) do
    scripts =
      root
      |> source_files(@script_directories, @script_extensions)
      |> Enum.flat_map(&numbered_lines(root, &1))

    demos =
      root
      |> source_files(~w(docs), :any)
      |> Enum.filter(&(Path.basename(&1) == "DEMO.md"))
      |> Enum.flat_map(&exec_block_lines(root, &1))

    for {subject, line} <- scripts ++ demos, problem <- kill_problems(line) do
      violation("processes", subject, "#{problem}: #{String.trim(line)}")
    end
  end

  defp kill_problems(line) do
    named =
      for command <- ~w(pkill killall),
          Regex.match?(~r/(?<![\w.-])#{command}(?=$|[\s;|&)'"`])/, line) do
        "#{command} stops processes by name"
      end

    unowned =
      for [_match, _flags, targets] <- Regex.scan(@kill_command, line),
          targets = String.split(targets),
          targets == [] or not Enum.all?(targets, &Regex.match?(@pid_reference, &1)) do
        "kill without a PID variable"
      end

    named ++ unowned
  end

  defp numbered_lines(root, relative_path) do
    root
    |> Path.expand()
    |> Path.join(relative_path)
    |> File.read!()
    |> String.split("\n")
    |> Enum.with_index(1)
    |> Enum.map(fn {line, number} -> {"#{relative_path}:#{number}", line} end)
  end

  defp exec_block_lines(root, relative_path) do
    root
    |> numbered_lines(relative_path)
    |> Enum.map_reduce(:prose, fn {_subject, line} = numbered, state ->
      case {state, String.trim(line)} do
        {:prose, "```output" <> _} -> {nil, :output}
        {:prose, "```" <> _} -> {nil, :exec}
        {_block, "```"} -> {nil, :prose}
        {:exec, _code} -> {numbered, :exec}
        {_other, _text} -> {nil, state}
      end
    end)
    |> elem(0)
    |> Enum.reject(&is_nil/1)
  end

  @spec e2e_violations(Path.t(), [String.t()]) :: [violation()]
  def e2e_violations(root, context_helpers) do
    sources = source_files(root, ~w(e2e), ~w(.ts .tsx .js .mjs .cjs))

    sleeps =
      Enum.flat_map(sources, &matching_lines(root, &1, @fixed_sleeps, "A20", "fixed sleep"))

    mocks =
      Enum.flat_map(sources, &matching_lines(root, &1, @transport_mocks, "A18", "transport mock"))

    contexts =
      sources
      |> Enum.reject(&(&1 in context_helpers))
      |> Enum.flat_map(
        &matching_lines(
          root,
          &1,
          @direct_contexts,
          "e2e_contexts",
          "browser context created outside the shared helper"
        )
      )

    sleeps ++ mocks ++ contexts ++ mock_package_violations(root)
  end

  defp mock_package_violations(root) do
    for {name, _version} <- package_dependencies(root, "e2e/package.json", :all),
        name in @mock_packages or String.starts_with?(name, "@mswjs/") do
      violation("A18", "e2e/package.json", "depends on mock library #{name}")
    end
  end

  @typedoc """
  Something a registry owns: its members as they appear in docs, whether a doc names them as
  plain words or in code form (`` `x` ``, `:x` or `"x"`), how many in one line make a list, and
  where the authoritative list lives.
  """
  @type owned_set :: %{
          name: String.t(),
          source: String.t(),
          members: [String.t()],
          form: :word | :code,
          min: pos_integer()
        }

  @doc """
  Lines of the living docs (every Markdown file at the root and directly in `docs/`, and
  `architecture/rules.exs`, except `exempt`) that enumerate `min` or more members of an owned set.
  A doc refers to the registry instead, so a new member never leaves a stale list behind.
  """
  @spec doc_enumeration_violations(Path.t(), [owned_set()], [String.t()]) :: [violation()]
  def doc_enumeration_violations(root, sets, exempt) do
    root = Path.expand(root)

    for file <- living_docs(root) -- exempt,
        {line, number} <-
          root |> Path.join(file) |> File.read!() |> String.split("\n") |> Enum.with_index(1),
        set <- sets,
        named = Enum.filter(set.members, &names?(line, &1, set.form)),
        length(named) >= set.min do
      violation(
        "doc_enumerations",
        "#{file}:#{number}",
        "lists #{length(named)} #{set.name} (#{Enum.join(named, ", ")}); refer to #{set.source} instead"
      )
    end
  end

  defp living_docs(root) do
    ["*.md", "docs/*.md", "architecture/rules.exs"]
    |> Enum.flat_map(&Path.wildcard(Path.join(root, &1)))
    |> Enum.map(&Path.relative_to(&1, root))
    |> Enum.sort()
  end

  defp names?(line, member, :word),
    do: Regex.match?(~r/(?<!\w)#{Regex.escape(member)}(?!\w)/, line)

  defp names?(line, member, :code) do
    member = Regex.escape(member)
    Regex.match?(~r/`#{member}`|(?<![\w:]):#{member}(?!\w)|"#{member}"/, line)
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
