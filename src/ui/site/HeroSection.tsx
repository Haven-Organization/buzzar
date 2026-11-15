import { useNavigate } from "react-router-dom";

import { Button } from "../atoms/button/Button";
import { Text } from "../atoms/text/Text";
import "./HeroSection.css";
import { Icon } from "../atoms/icon/Icon";
import ArrowForwardIC from "../../../res/ic/arrow-forward.svg";
import { isMobileDevice } from "../utils/common";

function HeroBanner() {
  return (
    <div className="HeroSection_Banner flex items-center gap-xxs">
      <Text color="surface" weight="bold">
        Buzzar continues Third Room, the Matrix.org Foundation&apos;s virtual world client.
      </Text>
      <Button fill="none" size="sm" onClick={() => window.open("/docs/guides/third-room", "_blank")}>
        <Text color="primary" weight="bold">
          Read More
        </Text>
      </Button>
    </div>
  );
}

function HeroPreview() {
  return (
    <div className="PreviewVideoPlayer">
      <img
        src="/landing/BuzzarHome.jpg"
        alt="The Buzzar Home world: a campfire clearing with log seats, trees and avatar pedestals"
        width={1400}
        height={788}
      />
    </div>
  );
}

export function HeroSection() {
  const navigate = useNavigate();

  return (
    <section className="HeroSection flex flex-column items-center">
      <HeroBanner />
      <div className="HeroSection__main flex flex-column items-center justify-center">
        <Text className="HeroSection__heading" variant="h2">
          Shared virtual worlds on Matrix
        </Text>
        <Button size="xl" onClick={() => navigate("/login")} disabled={isMobileDevice()}>
          <Text color="on-primary" weight="semi-bold">
            {isMobileDevice() ? "Try on Desktop" : "Get Started"}
          </Text>
          <Icon color="on-primary" src={ArrowForwardIC} />
        </Button>
      </div>
      <div className="HeroSection__video">
        <HeroPreview />
      </div>
      <div className="HeroSection__curve">
        <svg viewBox="0 0 1742 318" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M871 0.5C1508.5 0.5 1742 318 1742 318H0C0 318 233.5 0.5 871 0.5Z" fill="white" />
        </svg>
      </div>
    </section>
  );
}
