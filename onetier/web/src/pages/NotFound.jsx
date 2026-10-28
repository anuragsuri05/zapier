import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { EmptyState } from '../components/ui.jsx';

export default function NotFound() {
  return (
    <div className="page">
      <EmptyState icon={Compass} title="Page not found" action={<Link className="btn btn-primary" to="/">Back to home</Link>}>
        The page you’re looking for doesn’t exist or was moved.
      </EmptyState>
    </div>
  );
}
