import { BookTaskResponseService } from './book-task-responses';

describe('BookTaskResponseService', () => {
  it('creates stable device-local keys per profile, book and task', () => {
    const service = new BookTaskResponseService();
    expect(service.makeKey('book-1', 'task-2')).toBe('default:book-1:task-2');
    expect(service.makeKey('book-1', 'task-2', 'student-a')).toBe('student-a:book-1:task-2');
  });
});
