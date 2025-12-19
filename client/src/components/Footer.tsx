import { AlertCircle, Info } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export default function Footer() {
  return (
    <footer className="py-8 px-6 border-t border-border/50">
      <div className="max-w-4xl mx-auto space-y-6">
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="terms" className="border-border/30">
            <AccordionTrigger className="text-sm text-muted-foreground hover:no-underline">
              <div className="flex items-center gap-2">
                <Info className="w-4 h-4" />
                <span>Terms and Eligibility Information</span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-3 text-xs text-muted-foreground/80 pt-2">
                <p data-testid="text-disclaimer-code">
                  You must be signed up under code "Play" on Stake.us or Stake.com to qualify for this promotion.
                </p>
                <p data-testid="text-disclaimer-host">
                  This raffle/spins promotion is hosted and paid entirely by LukeTheDegen. Stake does not review accounts, approve entries, or verify eligibility.
                </p>
                <p data-testid="text-disclaimer-voluntary">
                  Users enter their Stake ID voluntarily. No Stake login or account access is required.
                </p>
                <div className="p-3 bg-muted/30 rounded-md space-y-1" data-testid="text-rtp-info">
                  <p className="font-medium text-muted-foreground">RTP Wager Counting:</p>
                  <ul className="list-disc list-inside space-y-1 pl-2">
                    <li>RTP 98% or less: 100% of wager counts</li>
                    <li>RTP above 98%: 50% of wager counts</li>
                    <li>RTP 99% or above: 10% of wager counts</li>
                  </ul>
                </div>
                <p data-testid="text-disclaimer-data">
                  Wager data is sourced from internal spreadsheets and may update periodically. Ensure your Stake ID is entered correctly.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <AlertCircle className="w-4 h-4" />
            <span className="text-xs">Prizes are paid to the Stake account matching the ID entered.</span>
          </div>
          <p className="text-xs text-muted-foreground/50">
            LukeRewards Spins
          </p>
        </div>
      </div>
    </footer>
  );
}
