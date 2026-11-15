// disable-noopener
import { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "../atoms/button/Button";
import { Logo } from "./NavigationBar";
import "./FooterSection.css";
import { Label } from "../atoms/text/Label";
import { Icon } from "../atoms/icon/Icon";
import { Text } from "../atoms/text/Text";
import MatrixLogoSVG from "../../../res/svg/matrix-logo.svg";
import GithubLogoSVG from "../../../res/svg/github-logo.svg";
import ArrowForwardIC from "../../../res/ic/arrow-forward.svg";
import { isMobileDevice } from "../utils/common";

function FooterMenu({ children }: { children: ReactNode }) {
  return <div className="flex flex-column gap-sm">{children}</div>;
}

export function FooterSection() {
  const navigate = useNavigate();

  return (
    <footer className="FooterSection flex flex-column items-center">
      <div className="FooterSection__content">
        <div className="FooterSection__branding flex justify-between items-center gap-md">
          <Logo />
          <Button size="lg" onClick={() => navigate("/login")} disabled={isMobileDevice()}>
            {isMobileDevice() ? "Try on Desktop" : "Get Started"}
            <Icon color="on-primary" src={ArrowForwardIC} />
          </Button>
        </div>
        <div className="flex flex-wrap gap-lg">
          <FooterMenu>
            <Label className="uppercase">Community</Label>
            <a href="https://github.com/Haven-Organization/buzzar" className="flex items-center gap-xs">
              <Icon size="sm" src={GithubLogoSVG} />
              <Text variant="b2" type="span">
                GitHub
              </Text>
            </a>
            <a href="https://matrix.org" className="flex items-center gap-xs">
              <Icon size="sm" src={MatrixLogoSVG} />
              <Text variant="b2" type="span">
                Built on Matrix
              </Text>
            </a>
            <a href="https://haven.software/buzzar/" className="flex items-center gap-xs">
              <Text variant="b2" type="span">
                Haven Software
              </Text>
            </a>
          </FooterMenu>
          <FooterMenu>
            <Label className="uppercase">Docs</Label>
            <a href="/docs/guides/">
              <Text variant="b2" type="span">
                Getting Started
              </Text>
            </a>
            <a href="/docs/guides/importing-worlds">
              <Text variant="b2" type="span">
                Importing Worlds
              </Text>
            </a>
            <a href="/docs/guides/self-hosting">
              <Text variant="b2" type="span">
                Self Hosting
              </Text>
            </a>
          </FooterMenu>
          <FooterMenu>
            <Label className="uppercase">From Third Room</Label>
            <a href="/preview">
              <Text variant="b2" type="span">
                Introducing Third Room
              </Text>
            </a>
            <a href="/docs/guides/third-room">
              <Text variant="b2" type="span">
                Coming from Third Room
              </Text>
            </a>
          </FooterMenu>
        </div>
        <div className="FooterSection__copyright">
          <Text variant="b2">
            {"Buzzar is open source under the Apache-2.0 license • Third Room © 2023 Element • "}
            <a href="https://github.com/Haven-Organization/buzzar/blob/develop/LICENSE">License</a>
          </Text>
        </div>
      </div>
    </footer>
  );
}
