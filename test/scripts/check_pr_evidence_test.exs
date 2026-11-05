defmodule Sketch.Scripts.CheckPrEvidenceTest do
  use ExUnit.Case, async: true

  @script Path.expand(".github/scripts/check_pr_evidence.sh")

  @passing %{
    "a Markdown image" => "Before and after\n\n![board](https://example.com/board.png)",
    "a GitHub attachment asset" =>
      "https://github.com/user-attachments/assets/0f3c1a52-1111-4222-8333-444455556666",
    "a GitHub attachment file" => "https://github.com/user-attachments/files/123/demo.txt",
    "a legacy user-images URL" => "https://user-images.githubusercontent.com/1/2.png",
    "an img tag" => ~s(<img width="600" src="x">),
    "a video tag" => ~s(<video src="https://example.com/demo" controls></video>),
    "a GIF link" => "See https://example.com/media/demo.GIF for the flow",
    "a linked MP4 with a query" => "[demo](https://example.com/demo.mp4?raw=true)",
    "a relative WebM link" => "[demo](docs/evidence/demo.webm)"
  }

  @failing %{
    "an empty body" => "",
    "text only" => "Fixes the zoom bug. No screenshot yet.",
    "a plain link" => "See https://example.com/docs/page for details",
    "a link whose path only mentions an extension" => "https://example.com/png/guide",
    "an unrelated attachment-like host" => "https://example.com/user-attachments/assets/1"
  }

  for {name, body} <- @passing do
    test "passes with #{name}" do
      assert {_, 0} = run(unquote(body))
    end
  end

  for {name, body} <- @failing do
    test "fails with #{name}" do
      assert {message, 1} = run(unquote(body))
      assert message =~ "screenshot or recording"
    end
  end

  test "treats a missing body as empty" do
    assert {_, 1} = System.cmd(@script, [], env: [{"BODY", nil}], stderr_to_stdout: true)
  end

  defp run(body) do
    System.cmd(@script, [], env: [{"BODY", body}], stderr_to_stdout: true)
  end
end
