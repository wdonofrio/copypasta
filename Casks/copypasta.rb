cask "copypasta" do
  version :latest
  sha256 :no_check

  arch arm: "arm64", intel: "x64"

  url "https://github.com/wdonofrio/copypasta/releases/latest/download/CopyPasta-#{arch}.dmg"
  name "CopyPasta"
  desc "Free, open-source Windows-style clipboard history for macOS"
  homepage "https://github.com/wdonofrio/copypasta"

  app "CopyPasta.app"
end
