import { Ticket, Gift } from "lucide-react";

export default function HeroSection() {
  return (
    <section className="text-center py-16 md:py-24 px-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex justify-center gap-3 mb-4">
          <div className="p-3 bg-primary/10 rounded-xl">
            <Ticket className="w-8 h-8 text-primary" />
          </div>
          <div className="p-3 bg-primary/10 rounded-xl">
            <Gift className="w-8 h-8 text-primary" />
          </div>
        </div>
        
        <h1 
          className="text-5xl md:text-6xl font-bold tracking-tight"
          data-testid="text-hero-title"
        >
          LukeRewards{" "}
          <span className="text-primary">Spins</span>
        </h1>
        
        <p 
          className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto"
          data-testid="text-hero-subtitle"
        >
          Every <span className="text-foreground font-semibold font-mono">$1,000</span> wagered = 1 ticket.
          <br />
          Each spin costs 1 ticket.
        </p>
        
        <p 
          className="text-sm text-muted-foreground/70"
          data-testid="text-hero-disclaimer"
        >
          Odds favor the house.
        </p>
      </div>
    </section>
  );
}
