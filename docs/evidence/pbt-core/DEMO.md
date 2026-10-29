# Core logic property tests

*2026-10-29T03:35:55Z by Showboat 0.6.1*
<!-- showboat-id: 136d43fe-c858-4c69-a570-637f87c9fba4 -->

**Outcome: the core rules of Sketch hold for every generated input, and each property fails with a small counterexample when the code it guards is broken.**

Proven with ExUnitProperties (StreamData, already a runtime dependency of Ash):

1. Last-write-wins merge (`Sketch.Canvas.BoardState`, ADR 0001 D0) is a CRDT: order-independent, idempotent, keeps the highest version per rectangle, ignores stale events, and two replicas converge. Pure, 500 runs each.
2. Geometry (addendum D1): Ash `create_rectangle` and a raw PostgreSQL insert each accept a position iff `0 <= x <= max_x` and `0 <= y <= max_y`, so the Ash constraints and the CHECK constraints agree. 100 runs each.
3. Commit model (A09, A11): random commits, in and out of bounds and against the wrong board, match a pure model after every operation (version = successful commits, position = last successful commit) and broadcast exactly once per successful commit, only on the rectangle's board. 50 runs of up to 15 ops.
4. Board isolation (A05): boards seeded with `Ash.Generator` list exactly their own rectangles. 50 runs.
5. Placement: the default position for any rectangle count is in bounds. 500 runs.

Outputs below are filtered by `run-tests.sh` to drop compile lines, the machine-dependent `max_cases` line and timings, so `showboat verify` can diff them.

```bash
docs/evidence/pbt-core/run-tests.sh test/sketch/properties --seed 1 --trace
```

```output


Sketch.Properties.BoardIsolationTest [test/sketch/properties/board_isolation_test.exs]
  * property each board lists exactly its own rectangles (A05) [L#16]

Sketch.Properties.GeometryTest [test/sketch/properties/geometry_test.exs]
  * property the default position of the next rectangle is within bounds [L#51]
  * property PostgreSQL alone accepts a position iff it is within the geometry bounds [L#43]
  * property Ash accepts a position iff it is within the geometry bounds [L#37]

Sketch.Properties.CommitModelTest [test/sketch/properties/commit_model_test.exs]
  * property the database and the broadcasts follow a model of successful commits (A09, A11) [L#76]

Sketch.Properties.LwwMergeTest [test/sketch/properties/lww_merge_test.exs]
  * property the state per rectangle is its highest-version event [L#54]
  * property an event older than the known version never changes the state [L#60]
  * property two replicas that saw disjoint halves converge in either merge order [L#75]
  * property applying an event twice equals applying it once [L#45]
  * property every delivery order of the same events yields the same state [L#39]


Result: 10 passed
```

The same suite is stable across other seeds:

```bash
for seed in 42 987654; do docs/evidence/pbt-core/run-tests.sh test/sketch/properties --seed $seed | grep Result; done
```

```output
Result: 10 passed
Result: 10 passed
```

## Mutation checks

Each check applies a patch from `mutations/` with `mutate.sh`, runs one property file with seed 1, and reverts the patch through an `EXIT` trap, so the tree is restored even when the run fails. `mutate.sh` exits 0 only when the mutation is killed and prints `MUTATION SURVIVED` otherwise.

### (a) The merge keeps the lower version

`mutations/merge-keeps-lower-version.patch` flips the guard in `BoardState.apply_event/2` so an event replaces the known one only when its version is not higher. Order independence, idempotence and convergence still hold ("lowest wins" is also a CRDT), which is why the highest-version and stale-event properties exist: both fail with two-event counterexamples.

```bash
docs/evidence/pbt-core/mutate.sh merge-keeps-lower-version test/sketch/properties/lww_merge_test.exs --seed 1
```

```output



  1) property the state per rectangle is its highest-version event (Sketch.Properties.LwwMergeTest)
     test/sketch/properties/lww_merge_test.exs:54
     Failed with generated values (after 4 successful runs):

         * Clause:    events <- events()
           Generated: [%{id: "d", version: 0, x: 0, y: 0}, %{id: "d", version: 1, x: 0, y: 0}]

     Assertion with == failed
     code:  assert BoardState.new(events).rectangles == highest_version_per_id(events)
     left:  %{"d" => %{id: "d", version: 0, x: 0, y: 0}}
     right: %{"d" => %{id: "d", version: 1, x: 0, y: 0}}
     stacktrace:
       test/sketch/properties/lww_merge_test.exs:56: anonymous fn/2 in Sketch.Properties.LwwMergeTest."property the state per rectangle is its highest-version event"/1
       (stream_data 1.4.0) lib/stream_data.ex:2585: StreamData.shrink_failure/5
       (stream_data 1.4.0) lib/stream_data.ex:2551: StreamData.check_all/7
       test/sketch/properties/lww_merge_test.exs:55: (test)



  2) property an event older than the known version never changes the state (Sketch.Properties.LwwMergeTest)
     test/sketch/properties/lww_merge_test.exs:60
     Failed with generated values (after 0 successful runs):

         * Clause:    events <- events()
           Generated: [%{id: "a", version: 0, x: 0, y: 0}]
         
         * Clause:    known <- member_of(events)
           Generated: %{id: "a", version: 0, x: 0, y: 0}
         
         * Clause:    age <- positive_integer()
           Generated: 1
         
         * Clause:    x <- integer(0..Geometry.max_x())
           Generated: 0

     match (=) failed
     The following variables were pinned:
       state = %Sketch.Canvas.BoardState{rectangles: %{"a" => %{id: "a", version: 0, x: 0, y: 0}}}
     code:  assert {:unchanged, ^state} = BoardState.apply_event(state, stale)
     left:  {:unchanged, ^state}
     right: {:changed,
             %Sketch.Canvas.BoardState{
               rectangles: %{
                 "a" => %{id: "a", version: -1, x: 0, y: 0}
               }
             }, %{id: "a", version: -1, x: 0, y: 0}}
     stacktrace:
       test/sketch/properties/lww_merge_test.exs:71: anonymous fn/5 in Sketch.Properties.LwwMergeTest."property an event older than the known version never changes the state"/1
       (stream_data 1.4.0) lib/stream_data.ex:2585: StreamData.shrink_failure/5
       (stream_data 1.4.0) lib/stream_data.ex:2551: StreamData.check_all/7
       test/sketch/properties/lww_merge_test.exs:61: (test)

...

Result: 3/5 passed
Failed: 2 properties
Mutation killed (mix test exit 2)
```

Reverted by the trap.

### (b) The Ash x bound drifts from the geometry by one

`mutations/ash-max-x-off-by-one.patch` sets the Ash attribute constraint to `max: @max_x - 1` while the PostgreSQL CHECK constraint keeps `3880`. The Ash property shrinks to the exact boundary `x = 3880`, and the raw-SQL property keeps passing, which shows the two layers disagree.

```bash
docs/evidence/pbt-core/mutate.sh ash-max-x-off-by-one test/sketch/properties/geometry_test.exs --seed 1
```

```output

..

  1) property Ash accepts a position iff it is within the geometry bounds (Sketch.Properties.GeometryTest)
     test/sketch/properties/geometry_test.exs:37
     Failed with generated values (after 25 successful runs):

         * Clause:    x <- coordinate(Geometry.max_x())
           Generated: 3880
         
         * Clause:    y <- coordinate(Geometry.max_y())
           Generated: 0

     Assertion with == failed
     code:  assert ash_accepts?(board, x, y) == in_bounds?(x, y)
     left:  false
     right: true
     stacktrace:
       test/sketch/properties/geometry_test.exs:39: anonymous fn/4 in Sketch.Properties.GeometryTest."property Ash accepts a position iff it is within the geometry bounds"/1
       (stream_data 1.4.0) lib/stream_data.ex:2585: StreamData.shrink_failure/5
       (stream_data 1.4.0) lib/stream_data.ex:2551: StreamData.check_all/7
       test/sketch/properties/geometry_test.exs:38: (test)



Result: 2/3 passed
Failed: 1 property
Mutation killed (mix test exit 2)
```

Reverted by the trap.

### (c) Commits stop incrementing the version

`mutations/version-not-incremented.patch` replaces `atomic_update(:version, expr(version + 1))` with `set_attribute(:version, 0)`. The commit model shrinks to a single in-bounds commit at the origin.

```bash
docs/evidence/pbt-core/mutate.sh version-not-incremented test/sketch/properties/commit_model_test.exs --seed 1
```

```output



  1) property the database and the broadcasts follow a model of successful commits (A09, A11) (Sketch.Properties.CommitModelTest)
     test/sketch/properties/commit_model_test.exs:76
     Failed with generated values (after 5 successful runs):

         * Clause:    ops <- list_of(op(), max_length: 15)
           Generated: [{:commit, 0, 0, 0}]

     Assertion with == failed
     code:  assert stored(ctx) == next
     left:  %{0 => {0, 0, 0}, 1 => {250, 250, 0}, 2 => {400, 400, 0}}
     right: %{0 => {0, 0, 1}, 1 => {250, 250, 0}, 2 => {400, 400, 0}}
     stacktrace:
       test/sketch/properties/commit_model_test.exs:89: anonymous fn/3 in Sketch.Properties.CommitModelTest."property the database and the broadcasts follow a model of successful commits (A09, A11)"/1
       (elixir 1.20.4) lib/enum.ex:2622: Enum."-reduce/3-lists^foldl/2-0-"/3
       test/sketch/properties/commit_model_test.exs:84: anonymous fn/2 in Sketch.Properties.CommitModelTest."property the database and the broadcasts follow a model of successful commits (A09, A11)"/1
       (stream_data 1.4.0) lib/stream_data.ex:2585: StreamData.shrink_failure/5
       (stream_data 1.4.0) lib/stream_data.ex:2551: StreamData.check_all/7
       test/sketch/properties/commit_model_test.exs:77: (test)



Result: 0/1 passed
Failed: 1 property
Mutation killed (mix test exit 2)
```

Reverted by the trap. The tree is clean again and the suite passes:

```bash
git diff --quiet -- lib && echo 'lib/ matches the committed tree' && docs/evidence/pbt-core/run-tests.sh test/sketch/properties --seed 1 | grep Result
```

```output
lib/ matches the committed tree
Result: 10 passed
```
