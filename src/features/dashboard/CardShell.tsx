import { useNavigate } from 'react-router-dom';
import { Card } from '../../components/ui';

export function CardShell({ title, link, children }: { title: string; link?: { label: string; to: string }; children: React.ReactNode }) {
  const navigate = useNavigate();
  return (
    <Card className="mb-3 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        {link && <button className="text-xs font-medium text-primary" onClick={() => navigate(link.to)}>{link.label}</button>}
      </div>
      {children}
    </Card>
  );
}
